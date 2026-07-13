# Resout le mot de passe / cle SSH VPS (env > fichier local > prompt)
param([switch]$Quiet)

$secretFile = Join-Path $PSScriptRoot '.vps-secret'
$keyFile = Join-Path $PSScriptRoot '.vps-key'

function Get-VpsPassword {
  if ($env:NEYA_VPS_PASSWORD) { return $env:NEYA_VPS_PASSWORD.Trim() }
  if (Test-Path $secretFile) {
    $line = (Get-Content $secretFile -Raw -ErrorAction SilentlyContinue).Trim()
    if ($line -and -not $line.StartsWith('#')) { return $line }
  }
  return $null
}

function Get-VpsKeyPath {
  if ($env:NEYA_VPS_KEY -and (Test-Path $env:NEYA_VPS_KEY)) { return $env:NEYA_VPS_KEY }
  if (Test-Path $keyFile) {
    $p = (Get-Content $keyFile -Raw -ErrorAction SilentlyContinue).Trim()
    if ($p -and (Test-Path $p)) { return $p }
  }
  if (Test-Path "$env:USERPROFILE\.ssh\id_rsa") { return "$env:USERPROFILE\.ssh\id_rsa" }
  return $null
}

function Test-PlaceholderPassword([string]$pw) {
  return $pw -match 'VOTRE_MOT_DE_PASSE|CHANGER_MOI|CHANGER|EXEMPLE|^xxx$'
}

$pw = Get-VpsPassword
$key = Get-VpsKeyPath

if (-not $Quiet) {
  if ($pw) {
    if (Test-PlaceholderPassword $pw) {
      Write-Host '(X) Mot de passe = placeholder' -ForegroundColor Red
    } else {
      Write-Host "(OK) Mot de passe ($($pw.Length) car.)" -ForegroundColor Green
    }
  } else {
    Write-Host '(X) Mot de passe absent' -ForegroundColor Red
    Write-Host "    Creez: $secretFile (1 ligne = mot de passe SSH OVH)" -ForegroundColor Yellow
  }
  if ($key) { Write-Host "(OK) Cle SSH: $key" -ForegroundColor Green }
}

return @{ Password = $pw; KeyPath = $key; SecretFile = $secretFile }
