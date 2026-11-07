param(
  [string]$Container = "onetab-b3-local",
  [string]$Database = "b3test"
)

$checkoutId = [guid]::NewGuid().ToString()
$requestId = [guid]::NewGuid().ToString()
$walletA = "payer-a-$([guid]::NewGuid().ToString('N'))"
$walletB = "payer-b-$([guid]::NewGuid().ToString('N'))"
$create = "select public.create_checkout('$checkoutId', '$requestId', 'Race room', 'organizer-race', 'seller-race', 10, 2::smallint, 'devnet', 'mint', 6::smallint);"
& docker exec $Container psql -U postgres -d $Database -v ON_ERROR_STOP=1 -c $create
if ($LASTEXITCODE -ne 0) { throw "Could not create the disposable race checkout." }

$claim = {
  param($TargetContainer, $TargetDatabase, $TargetCheckout, $Wallet)
  $statement = "select public.join_checkout('$TargetCheckout', '$Wallet');"
  $output = & docker exec $TargetContainer psql -U postgres -d $TargetDatabase -v ON_ERROR_STOP=1 -Atc $statement 2>&1
  [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
}
$first = Start-Job -ScriptBlock $claim -ArgumentList $Container, $Database, $checkoutId, $walletA
$second = Start-Job -ScriptBlock $claim -ArgumentList $Container, $Database, $checkoutId, $walletB
$results = @($first, $second) | Wait-Job | Receive-Job
Remove-Job $first, $second
$successes = @($results | Where-Object { $_.ExitCode -eq 0 -and $_.Output.Trim() -eq "1" }).Count
$fullErrors = @($results | Where-Object { $_.ExitCode -ne 0 -and $_.Output -match "ROOM_FULL" }).Count
if ($successes -ne 1 -or $fullErrors -ne 1) {
  $results | Format-List | Out-String | Write-Error
  throw "Concurrent final-slot claims did not produce one slot-1 winner and one ROOM_FULL result."
}
$verify = "select count(*) from public.participants where checkout_id='$checkoutId';"
$count = (& docker exec $Container psql -U postgres -d $Database -Atc $verify).Trim()
if ($LASTEXITCODE -ne 0 -or $count -ne "2") { throw "The race checkout did not persist exactly two participants." }
Write-Output "Concurrent join passed: one winner, one ROOM_FULL, and two total participants."
