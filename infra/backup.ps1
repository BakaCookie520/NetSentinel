param(
  [Parameter(Mandatory = $true)][string]$OutputPath
)
$resolved = [System.IO.Path]::GetFullPath($OutputPath)
docker compose exec -T postgres pg_dump -U netsentinel -d netsentinel --no-owner --no-acl | Out-File -Encoding utf8 -LiteralPath $resolved
Write-Output "Backup written to $resolved"
