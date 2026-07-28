param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+$')][string]$Version,
  [string]$OutputDirectory = "artifacts"
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
$stageRoot = Join-Path $repoRoot ".runtime\agent-package"
$packageName = "netsentinel-agent-$Version"
$packageRoot = Join-Path $stageRoot $packageName

if (Test-Path -LiteralPath $packageRoot) { Remove-Item -Recurse -Force -LiteralPath $packageRoot }
New-Item -ItemType Directory -Force -Path $outputRoot, $packageRoot | Out-Null
pnpm --dir $repoRoot --filter @netsentinel/agent build
if ($LASTEXITCODE -ne 0) { throw "Agent build failed" }
pnpm --dir $repoRoot --filter @netsentinel/agent deploy --legacy --prod $packageRoot
if ($LASTEXITCODE -ne 0) { throw "Agent dependency deployment failed" }
foreach ($path in @(".turbo", "src", "tsconfig.json")) {
  $candidate = Join-Path $packageRoot $path
  if (Test-Path -LiteralPath $candidate) { Remove-Item -Recurse -Force -LiteralPath $candidate }
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "agent\netsentinel-agent.service") -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "agent\install.sh") -Destination $packageRoot

$archive = Join-Path $outputRoot "$packageName.tar.gz"
tar.exe -czf $archive -C $stageRoot $packageName
if ($LASTEXITCODE -ne 0) { throw "Agent archive creation failed" }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
Set-Content -Encoding ascii -LiteralPath "$archive.sha256" -Value "$hash  $packageName.tar.gz"
Write-Output "Agent package written to $archive"
