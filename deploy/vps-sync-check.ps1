# Diagnostic avant deploy VPS — lancez ceci si vps-sync-local.ps1 echoue
param(
  [string]$VpsHost = $(if ($env:NEYA_VPS_HOST) { $env:NEYA_VPS_HOST } else { '51.222.31.75' }),
  [string]$User = 'ubuntu'
)

$ErrorActionPreference = 'Continue'
Write-Host "=== Diagnostic deploy NEYA ===" -ForegroundColor Cyan
Write-Host "Hote: $User@$VpsHost"
Write-Host ""

# 1. Mot de passe
$cred = & (Join-Path $PSScriptRoot 'resolve-vps-credential.ps1') -Quiet
$pw = $cred.Password
$key = $cred.KeyPath
$secretFile = $cred.SecretFile

if (-not $pw) {
  Write-Host '(X) Mot de passe SSH non defini' -ForegroundColor Red
  Write-Host '    Option A - fichier (recommande):' -ForegroundColor Yellow
  Write-Host "      notepad $secretFile" -ForegroundColor Yellow
  Write-Host '      (1 ligne = mot de passe OVH, sauvegardez, relancez)' -ForegroundColor Yellow
  Write-Host '    Option B - variable session:' -ForegroundColor Yellow
  Write-Host '      $env:NEYA_VPS_PASSWORD = "votre-mot-de-passe-ovh"' -ForegroundColor Yellow
  Write-Host '      .\deploy\vps-sync-local.ps1' -ForegroundColor Yellow
} elseif ($pw -match 'VOTRE_MOT_DE_PASSE|CHANGER_MOI|CHANGER|EXEMPLE|^xxx$') {
  Write-Host '(X) Mot de passe = placeholder (pas le vrai mot de passe OVH)' -ForegroundColor Red
} else {
  Write-Host "(OK) Mot de passe defini ($($pw.Length) caracteres)" -ForegroundColor Green
}

if ($key -and (Test-Path $key)) {
  Write-Host "(OK) Cle SSH: $key" -ForegroundColor Green
} elseif (Test-Path "$env:USERPROFILE\.ssh\id_rsa") {
  Write-Host "(i) Cle par defaut: $env:USERPROFILE\.ssh\id_rsa" -ForegroundColor Yellow
}

# 2. Reseau
Write-Host ""
Write-Host "Test port 22..."
try {
  $t = Test-NetConnection -ComputerName $VpsHost -Port 22 -WarningAction SilentlyContinue
  if ($t.TcpTestSucceeded) {
    Write-Host '(OK) Port 22 accessible' -ForegroundColor Green
  } else {
    Write-Host '(X) Port 22 inaccessible — firewall OVH ou mauvaise IP' -ForegroundColor Red
  }
} catch {
  Write-Host "(X) Test reseau: $($_.Exception.Message)" -ForegroundColor Red
}

# 3. Archive
$zip = Join-Path $PSScriptRoot 'neya-erp-deploy.zip'
if (Test-Path $zip) {
  $mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
  Write-Host "(OK) Archive $zip - ${mb} MB" -ForegroundColor Green
} else {
  Write-Host '(i) Archive absente — sera creee par pack-for-vps.ps1' -ForegroundColor Yellow
}

# 4. Posh-SSH
Write-Host ""
if (Get-Module -ListAvailable -Name Posh-SSH) {
  $v = (Get-Module -ListAvailable -Name Posh-SSH | Select-Object -First 1).Version
  Write-Host "(OK) Module Posh-SSH $v" -ForegroundColor Green
} else {
  Write-Host '(!) Posh-SSH non installe - vps-sync-local.ps1 tentera l''installation' -ForegroundColor Yellow
  Write-Host "    Manuel: Install-Module Posh-SSH -Force -Scope CurrentUser"
}

# 5. OpenSSH natif
if (Get-Command ssh -ErrorAction SilentlyContinue) {
  Write-Host "(OK) OpenSSH client: $(Get-Command ssh | Select-Object -ExpandProperty Source)" -ForegroundColor Green
} else {
  Write-Host '(i) OpenSSH absent — Parametres Windows > Client OpenSSH' -ForegroundColor Yellow
}

# 6. Test SSH rapide (si mot de passe ou cle)
Write-Host ""
if ($pw -or ($key -and (Test-Path $key))) {
  Write-Host "Test connexion SSH (echo ok)..."
  try {
    if ($key -and (Test-Path $key)) {
      $out = ssh -i $key -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "${User}@${VpsHost}" "echo ok" 2>&1
    } elseif ($pw) {
      if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
        Install-Module -Name Posh-SSH -Force -Scope CurrentUser -AllowClobber -ErrorAction SilentlyContinue
      }
      Import-Module Posh-SSH -ErrorAction SilentlyContinue
      $cred = New-Object PSCredential($User, (ConvertTo-SecureString $pw -AsPlainText -Force))
      $s = New-SSHSession -ComputerName $VpsHost -Credential $cred -AcceptKey -ConnectionTimeout 15 -ErrorAction Stop
      $r = Invoke-SSHCommand -SessionId $s.SessionId -Command 'echo ok' -TimeOut 30
      Remove-SSHSession -SessionId $s.SessionId | Out-Null
      $out = if ($r.ExitStatus -eq 0) { 'ok' } else { $r.Error -join ' ' }
    }
    if ($out -match 'ok') {
      Write-Host '(OK) Connexion SSH reussie' -ForegroundColor Green
    } else {
      Write-Host "(X) Connexion SSH echouee: $out" -ForegroundColor Red
    }
  } catch {
    Write-Host "(X) Connexion SSH echouee: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "    Verifiez le mot de passe OVH (email livraison VPS) ou utilisez une cle SSH." -ForegroundColor Yellow
  }
} else {
  Write-Host '(i) Pas de test SSH (mot de passe ou cle manquant)' -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Si tout est OK : .\deploy\vps-sync-local.ps1" -ForegroundColor Cyan
