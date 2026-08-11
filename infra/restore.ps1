[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [string]$AvatarInputPath = "$InputPath.avatars"
)

$resolved = [System.IO.Path]::GetFullPath($InputPath)
if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
  throw "Backup file does not exist: $resolved"
}
$avatarResolved = [System.IO.Path]::GetFullPath($AvatarInputPath)

if ($PSCmdlet.ShouldProcess("NetSentinel PostgreSQL database", "Replace all data from $resolved")) {
  docker compose stop app worker
  try {
    docker compose exec -T postgres dropdb -U netsentinel --if-exists netsentinel
    docker compose exec -T postgres createdb -U netsentinel netsentinel
    Get-Content -Raw -LiteralPath $resolved | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U netsentinel -d netsentinel
    if ($LASTEXITCODE -ne 0) { throw "Database restore failed" }

    if (Test-Path -LiteralPath $avatarResolved -PathType Container) {
      $container = docker create --volume netsentinel_app-data:/source alpine:3.20 sleep 60
      try {
        docker exec $container rm -rf /source/avatars
        docker cp $avatarResolved "$container`:/source/avatars"
      } finally {
        docker rm $container | Out-Null
      }
    }
  } finally {
    docker compose start app worker
  }
  Write-Output "Database restored from $resolved"
  if (Test-Path -LiteralPath $avatarResolved -PathType Container) {
    Write-Output "Avatars restored from $avatarResolved"
  }
}
