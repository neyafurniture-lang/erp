# NEYA ERP — archive pour upload VPS (sans node_modules)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$Zip = Join-Path $PSScriptRoot 'neya-erp-deploy.zip'
$Stage = Join-Path $env:TEMP "neya-erp-stage-$(Get-Random)"

Write-Host "Projet: $ProjectRoot"
Write-Host "Archive: $Zip"

if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $Stage | Out-Null

foreach ($item in @('backend', 'frontend', 'deploy', 'docker-compose.prod.yml', 'VERSION')) {
  $src = Join-Path $ProjectRoot $item
  if (-not (Test-Path $src)) { Write-Warning "Manquant: $src"; continue }
  Copy-Item $src -Destination (Join-Path $Stage $item) -Recurse -Force
}

foreach ($p in @(
  'backend\node_modules', 'frontend\node_modules', 'frontend\.next',
  'backend\uploads', 'backend\.env', 'frontend\.env.local',
  'deploy\neya-erp-deploy.zip'
)) {
  $full = Join-Path $Stage $p
  if (Test-Path $full) { Remove-Item $full -Recurse -Force }
}

if (Test-Path $Zip) { Remove-Item $Zip -Force }
Compress-Archive -Path "$Stage\*" -DestinationPath $Zip -CompressionLevel Optimal
Remove-Item $Stage -Recurse -Force

$size = [math]::Round((Get-Item $Zip).Length / 1MB, 1)
Write-Host "OK - $Zip - ${size} MB"
