[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
  [Parameter(Mandatory = $true)][string]$InputPath
)

$resolved = [System.IO.Path]::GetFullPath($InputPath)
if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
  throw "Backup file does not exist: $resolved"
}

if ($PSCmdlet.ShouldProcess("NetSentinel PostgreSQL database", "Replace all data from $resolved")) {
  docker compose stop api worker
  docker compose exec -T postgres dropdb -U netsentinel --if-exists netsentinel
  docker compose exec -T postgres createdb -U netsentinel netsentinel
  Get-Content -Raw -LiteralPath $resolved | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U netsentinel -d netsentinel
  if ($LASTEXITCODE -ne 0) { throw "Database restore failed" }
  docker compose start api worker
  Write-Output "Database restored from $resolved"
}
