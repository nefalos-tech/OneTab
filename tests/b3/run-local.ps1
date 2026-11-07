param(
  [string]$Container = "onetab-b3-$([guid]::NewGuid().ToString('N'))",
  [string]$Database = "b3test"
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
  docker run --name $Container --rm -d -e POSTGRES_PASSWORD=onetab-b3-test-only -e "POSTGRES_DB=$Database" postgres:16 | Out-Null
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

  Invoke-SqlFile (Join-Path $PSScriptRoot "../../supabase/migrations/20261107000000_b1_schema.sql")
  Invoke-SqlFile (Join-Path $PSScriptRoot "../../supabase/migrations/20261107010000_b2_auth.sql")
  Invoke-SqlFile (Join-Path $PSScriptRoot "../../supabase/migrations/20261107020000_b3_rooms.sql")
  Invoke-SqlFile (Join-Path $PSScriptRoot "rooms.sql")
  & (Join-Path $PSScriptRoot "concurrent-join.ps1") -Container $Container -Database $Database
  if ($LASTEXITCODE -ne 0) { throw "The concurrent join verification failed." }
  Write-Output "B1, B2 and B3 PostgreSQL checks passed. The disposable container will now be removed."
}
finally {
  if ($started) {
    docker stop $Container | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not stop the disposable container '$Container'." }
  }
}
