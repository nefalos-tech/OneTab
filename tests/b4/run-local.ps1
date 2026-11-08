param(
  [string]$Container = "onetab-b4-$([guid]::NewGuid().ToString('N'))",
  [string]$Database = "b4test"
)

$ErrorActionPreference = "Stop"
$started = $false
$existing = docker ps -a --filter "name=^/$Container$" --format "{{.Names}}"
if ($LASTEXITCODE -ne 0) { throw "Could not check whether the requested test container name is in use." }
if ($existing) { throw "Container '$Container' already exists. Choose a different name; the script will not reuse or remove it." }

function Invoke-SqlFile([string]$Path) {
  Get-Content -Raw -LiteralPath $Path | docker exec -i $Container psql -U postgres -d $Database -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL failed while applying $Path." }
}

try {
  docker run --name $Container --rm -d -e POSTGRES_PASSWORD=onetab-b4-test-only -e "POSTGRES_DB=$Database" postgres:16 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not start a disposable PostgreSQL 16 container." }
  $started = $true

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    docker exec $Container psql -U postgres -d $Database -c "select 1" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "PostgreSQL did not become ready within 30 seconds." }

  @'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
'@ | docker exec -i $Container psql -U postgres -d $Database -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "Could not create the Supabase test roles." }

  foreach ($migration in @(
    "../../supabase/migrations/20261107000000_b1_schema.sql",
    "../../supabase/migrations/20261107010000_b2_auth.sql",
    "../../supabase/migrations/20261107020000_b3_rooms.sql",
    "../../supabase/migrations/20261108000000_b4_attempt_store.sql"
  )) {
    Invoke-SqlFile (Join-Path $PSScriptRoot $migration)
  }

  Invoke-SqlFile (Join-Path $PSScriptRoot "attempt-store.sql")

  $reserveSql = @'
begin;
select id from public.checkouts where id='20000000-0000-4000-8000-000000000003' for update;
select pg_sleep(1);
select public.reserve_attempt('20000000-0000-4000-8000-000000000003','organizer-2',null)->>'id';
commit;
'@
  $reserveJobA = Start-Job -ScriptBlock { param($name,$sql) $sql | docker exec -i $name psql -U postgres -d b4test -qAt -v ON_ERROR_STOP=1 } -ArgumentList $Container,$reserveSql
  $reserveJobB = Start-Job -ScriptBlock { param($name,$sql) $sql | docker exec -i $name psql -U postgres -d b4test -qAt -v ON_ERROR_STOP=1 } -ArgumentList $Container,$reserveSql
  $reserveJobs = @($reserveJobA,$reserveJobB)
  $reserveJobs | Wait-Job -Timeout 30 | Out-Null
  if (($reserveJobs | Where-Object State -ne "Completed").Count -ne 0) { throw "Concurrent reservation calls did not finish." }
  $reservedIds = @()
  foreach ($job in $reserveJobs) {
    $jobOutput = @(Receive-Job $job)
    $reservedIds += ($jobOutput | Where-Object { $_ -match '^[0-9a-f-]{36}$' } | Select-Object -Last 1)
  }
  $reserveJobs | Remove-Job
  if ($reservedIds.Count -ne 2 -or $reservedIds[0] -ne $reservedIds[1]) { throw "Concurrent reserve calls did not return the same attempt." }
  $attemptId = $reservedIds[0]

  @'
do $$
declare attempt_id uuid; lease jsonb; payload jsonb;
begin
  select id into attempt_id from public.attempts where checkout_id='20000000-0000-4000-8000-000000000003';
  lease := public.claim_attempt_preparation(attempt_id);
  payload := jsonb_build_object(
    'attemptId',attempt_id,'checkoutId','20000000-0000-4000-8000-000000000003',
    'transactionBase64','RklYVFVSRQ==','messageBase64','RklYVFVSRQ==','messageHash',repeat('1',64),
    'blockhash',repeat('2',32),'lastValidBlockHeight','123456',
    'payment',jsonb_build_object('network','devnet','mint','mint','tokenDecimals',6,'sellerWallet','seller-2',
      'sellerTokenAccount','seller-token-2','feePayerWallet','organizer-2','contributions',jsonb_build_array(
        jsonb_build_object('slot',0,'wallet','organizer-2','amountUnits','5','sourceTokenAccount','source-c'),
        jsonb_build_object('slot',1,'wallet','payer-2','amountUnits','5','sourceTokenAccount','source-d'))));
  perform public.freeze_attempt_message(attempt_id,(lease->>'token')::uuid,payload);
end $$;
'@ | docker exec -i $Container psql -U postgres -d $Database -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "Could not prepare the concurrent signature attempt." }

  $signatureJobA = Start-Job -ScriptBlock { param($name,$db,$id) docker exec $name psql -U postgres -d $db -qAt -v ON_ERROR_STOP=1 -c "select public.put_attempt_signature('$id','organizer-2',repeat('1',64),repeat('A',86)||'==')" } -ArgumentList $Container,$Database,$attemptId
  $signatureJobB = Start-Job -ScriptBlock { param($name,$db,$id) docker exec $name psql -U postgres -d $db -qAt -v ON_ERROR_STOP=1 -c "select public.put_attempt_signature('$id','payer-2',repeat('1',64),repeat('B',86)||'==')" } -ArgumentList $Container,$Database,$attemptId
  $signatureJobs = @($signatureJobA,$signatureJobB)
  $signatureJobs | Wait-Job -Timeout 30 | Out-Null
  if (($signatureJobs | Where-Object State -ne "Completed").Count -ne 0) { throw "Concurrent signature writes did not finish." }
  foreach ($job in $signatureJobs) { Receive-Job $job | Out-Null; if ($job.State -ne "Completed") { throw "A concurrent signature write failed." } }
  $signatureJobs | Remove-Job
  $signatureCount = (docker exec $Container psql -U postgres -d $Database -Atc "select count(*) from public.signatures where attempt_id='$attemptId'").Trim()
  if ($LASTEXITCODE -ne 0 -or $signatureCount -ne "2") { throw "Concurrent signature writes did not preserve both signatures." }

  $claimSql = "select public.claim_attempt_submission('$attemptId','Ag==',repeat('3',87))::text"
  $claimJobA = Start-Job -ScriptBlock { param($name,$db,$sql) docker exec $name psql -U postgres -d $db -qAt -v ON_ERROR_STOP=1 -c $sql } -ArgumentList $Container,$Database,$claimSql
  $claimJobB = Start-Job -ScriptBlock { param($name,$db,$sql) docker exec $name psql -U postgres -d $db -qAt -v ON_ERROR_STOP=1 -c $sql } -ArgumentList $Container,$Database,$claimSql
  $claimJobs = @($claimJobA,$claimJobB)
  $claimJobs | Wait-Job -Timeout 30 | Out-Null
  if (($claimJobs | Where-Object State -ne "Completed").Count -ne 0) { throw "Concurrent submission claims did not finish." }
  $claims = @($claimJobs | ForEach-Object { (Receive-Job $_ | Select-Object -Last 1) | ConvertFrom-Json })
  $claimJobs | Remove-Job
  if ($claims.Count -ne 2 -or @($claims | Where-Object { $null -ne $_.lease }).Count -ne 1 -or @($claims | Where-Object { $_.submission.transactionReference -eq ("3" * 87) }).Count -ne 2) { throw "Submission claims did not yield one lease and the same canonical transaction." }

  docker restart $Container | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not restart the disposable database container." }

  $persisted = (docker exec $Container psql -U postgres -d $Database -Atc "select state || ':' || (select count(*) from public.signatures where attempt_id=a.id)::text || ':' || (select transaction_reference from public.submissions where attempt_id=a.id) || ':' || (public.get_attempt(a.id)->'signingPayload'->>'messageBase64') || ':' || (public.get_attempt(a.id)->'signingPayload'->>'messageHash') from public.attempts a where checkout_id='20000000-0000-4000-8000-000000000001'").Trim()
  if ($LASTEXITCODE -ne 0 -or $persisted -ne ("confirmed:2:" + ("2" * 87) + ":RklYVFVSRQ==:" + ("0" * 64))) { throw "Attempt and frozen message did not survive the database restart. Observed '$persisted'." }
  $concurrentPersisted = (docker exec $Container psql -U postgres -d $Database -Atc "select state || ':' || (select count(*) from public.signatures where attempt_id=a.id)::text || ':' || (select transaction_reference from public.submissions where attempt_id=a.id) || ':' || (public.get_attempt(a.id)->'signingPayload'->>'messageBase64') || ':' || (public.get_attempt(a.id)->'signingPayload'->>'messageHash') from public.attempts a where id='$attemptId'").Trim()
  if ($LASTEXITCODE -ne 0 -or $concurrentPersisted -ne ("submitting:2:" + ("3" * 87) + ":RklYVFVSRQ==:" + ("1" * 64))) { throw "Concurrent attempt and frozen message did not survive the database restart. Observed '$concurrentPersisted'." }

  Write-Output "B4 reservation, signature, submission-claim concurrency, migration, and restart-persistence checks passed. The disposable container will now be removed."
}
finally {
  if ($started) {
    docker stop $Container | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not stop the disposable container '$Container'." }
  }
}
