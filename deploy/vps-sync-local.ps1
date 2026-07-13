# NEYA ERP — synchronise le local vers le VPS (mise a jour sans effacer .env)
# Usage:
#   $env:NEYA_VPS_PASSWORD = "mot-de-passe-ssh-ovh"
#   .\deploy\vps-sync-local.ps1
#
# Avec cle SSH (recommande):
#   $env:NEYA_VPS_KEY = "$env:USERPROFILE\.ssh\id_rsa"
#   .\deploy\vps-sync-local.ps1
#
# Diagnostic si probleme:
#   .\deploy\vps-sync-check.ps1
param(
  [string]$VpsHost = $(if ($env:NEYA_VPS_HOST) { $env:NEYA_VPS_HOST } else { '51.222.31.75' }),
  [string]$User = 'ubuntu',
  [string]$KeyFile = '',
  [switch]$SkipPack
)

$ErrorActionPreference = 'Stop'
$Zip = Join-Path $PSScriptRoot 'neya-erp-deploy.zip'
$RemoteScript = Join-Path $PSScriptRoot 'remote-update.sh'
$cred = & (Join-Path $PSScriptRoot 'resolve-vps-credential.ps1') -Quiet
$secretFile = $cred.SecretFile

function Write-Step($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Fail($msg) {
  Write-Host ""
  Write-Host "ERREUR: $msg" -ForegroundColor Red
  Write-Host "Lancez: .\deploy\vps-sync-check.ps1" -ForegroundColor Yellow
  Write-Host "Ou creez deploy\.vps-secret (1 ligne = mot de passe SSH OVH)" -ForegroundColor Yellow
  exit 1
}

$plain = $cred.Password
$KeyFile = $cred.KeyPath
$useKey = $KeyFile -and (Test-Path $KeyFile)

if ($plain -match 'VOTRE_MOT_DE_PASSE|CHANGER_MOI|CHANGER|EXEMPLE|^xxx$') {
  Fail "Mot de passe placeholder. Mettez le vrai mot de passe dans deploy\.vps-secret ou NEYA_VPS_PASSWORD."
}

if (-not $useKey -and -not $plain) {
  Write-Host "Mot de passe SSH pour ${User}@${VpsHost} (ou definissez NEYA_VPS_PASSWORD / NEYA_VPS_KEY)" -ForegroundColor Yellow
  $sec = Read-Host 'Mot de passe' -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  )
}
if (-not $useKey -and -not $plain) { Fail 'Mot de passe SSH vide.' }

Write-Step '0/4 Test reseau (port 22)...'
try {
  $tcp = Test-NetConnection -ComputerName $VpsHost -Port 22 -WarningAction SilentlyContinue
  if (-not $tcp.TcpTestSucceeded) { Fail "Port 22 inaccessible sur $VpsHost - verifiez l IP (51.222.31.75) et le firewall OVH." }
} catch {
  Fail "Test reseau: $($_.Exception.Message)"
}

if (-not $SkipPack) {
  Write-Step '1/4 Archive locale...'
  & (Join-Path $PSScriptRoot 'pack-for-vps.ps1')
} elseif (-not (Test-Path $Zip)) {
  Fail "Archive introuvable ($Zip). Relancez sans -SkipPack."
}
if (-not (Test-Path $Zip)) { Fail "Archive introuvable: $Zip" }
if (-not (Test-Path $RemoteScript)) { Fail "Script distant introuvable: $RemoteScript" }

# --- Mode cle SSH (OpenSSH natif, plus fiable sur Windows) ---
if ($useKey) {
  Write-Step "2/4 Connexion SSH (cle: $KeyFile)..."
  $sshBase = @('ssh', '-i', $KeyFile, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=30', "${User}@${VpsHost}")
  $scpBase = @('scp', '-i', $KeyFile, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=30')

  & @sshBase 'echo ok' 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "Connexion SSH refusee avec la cle $KeyFile" }

  Write-Step '3/4 Upload (scp)...'
  & @sshBase 'mkdir -p /tmp/neya-upload' | Out-Null
  & @($scpBase + @($Zip, "${User}@${VpsHost}:/tmp/neya-upload/"))
  if ($LASTEXITCODE -ne 0) { Fail 'Upload archive echoue (scp)' }
  & @($scpBase + @($RemoteScript, "${User}@${VpsHost}:/tmp/neya-upload/"))
  if ($LASTEXITCODE -ne 0) { Fail 'Upload script echoue (scp)' }

  Write-Step '4/4 Mise a jour VPS (build Docker 10-15 min)...'
  $remoteCmd = "sed -i 's/\r$//' /tmp/neya-upload/remote-update.sh && chmod +x /tmp/neya-upload/remote-update.sh && bash /tmp/neya-upload/remote-update.sh $User"
  & @sshBase $remoteCmd
  if ($LASTEXITCODE -ne 0) { Fail "Deploiement distant echoue (code $LASTEXITCODE)" }
}
else {
  # --- Mode mot de passe (Posh-SSH) ---
  if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
    Write-Host 'Installation Posh-SSH (une fois)...' -ForegroundColor Yellow
    try {
      Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue
      Install-Module -Name Posh-SSH -Force -Scope CurrentUser -AllowClobber
    } catch {
      Fail "Impossible d installer Posh-SSH: $($_.Exception.Message). Essayez: Install-Module Posh-SSH -Scope CurrentUser"
    }
  }
  Import-Module Posh-SSH

  $cred = New-Object System.Management.Automation.PSCredential($User, (ConvertTo-SecureString $plain -AsPlainText -Force))

  Write-Step "2/4 Connexion $User@$VpsHost ..."
  try {
    $session = New-SSHSession -ComputerName $VpsHost -Credential $cred -AcceptKey -ConnectionTimeout 30 -ErrorAction Stop
  } catch {
    Fail "Connexion SSH refusee: $($_.Exception.Message). Verifiez le mot de passe OVH avec .\deploy\vps-sync-check.ps1"
  }

  function Invoke-Remote($cmd, [int]$timeout = 600) {
    $r = Invoke-SSHCommand -SessionId $session.SessionId -Command $cmd -TimeOut $timeout
    if ($r.Output) { $r.Output | ForEach-Object { Write-Host $_ } }
    if ($r.Error) { $r.Error | ForEach-Object { Write-Warning $_ } }
    if ($r.ExitStatus -ne 0) { throw "Commande distante echouee ($($r.ExitStatus)): $cmd" }
    return $r
  }

  try {
    Write-Step '3/4 Upload...'
    Invoke-Remote "mkdir -p /tmp/neya-upload /opt/neya-erp && sudo chown -R ${User}:${User} /tmp/neya-upload /opt/neya-erp 2>/dev/null || true" 120

    Set-SCPItem -ComputerName $VpsHost -Credential $cred -Path $Zip -Destination '/tmp/neya-upload/' -AcceptKey -ErrorAction Stop
    Set-SCPItem -ComputerName $VpsHost -Credential $cred -Path $RemoteScript -Destination '/tmp/neya-upload/' -AcceptKey -ErrorAction Stop

    Write-Step '4/4 Mise a jour VPS (build Docker 10-15 min)...'
    $cmd = "sed -i 's/\r$//' /tmp/neya-upload/remote-update.sh && chmod +x /tmp/neya-upload/remote-update.sh && bash /tmp/neya-upload/remote-update.sh $User"
    $r = Invoke-SSHCommand -SessionId $session.SessionId -Command $cmd -TimeOut 1800
    if ($r.Output) { $r.Output | ForEach-Object { Write-Host $_ } }
    if ($r.Error) { $r.Error | ForEach-Object { Write-Warning $_ } }
    if ($r.ExitStatus -ne 0) { Fail "Deploiement distant echoue (code $($r.ExitStatus)). Logs ci-dessus." }
  } finally {
    Remove-SSHSession -SessionId $session.SessionId -ErrorAction SilentlyContinue | Out-Null
  }
}

Write-Host ''
Write-Host '=== Deploy termine ===' -ForegroundColor Green
Write-Host "Health: http://${VpsHost}/health"
Write-Host "ERP:    https://erp.neyafurniture.ca/health"
