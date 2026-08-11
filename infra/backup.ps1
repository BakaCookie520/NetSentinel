param(
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$AvatarOutputPath = "$OutputPath.avatars"
)
$resolved = [System.IO.Path]::GetFullPath($OutputPath)
docker compose exec -T postgres pg_dump -U netsentinel -d netsentinel --no-owner --no-acl | Out-File -Encoding utf8 -LiteralPath $resolved

$avatarResolved = [System.IO.Path]::GetFullPath($AvatarOutputPath)
$container = docker create --volume netsentinel_app-data:/source alpine:3.20 sleep 60
try {
  docker cp "$container`:/source/avatars" $avatarResolved
} finally {
  docker rm $container | Out-Null
}
Write-Output "Database backup written to $resolved"
Write-Output "Avatar backup written to $avatarResolved"
