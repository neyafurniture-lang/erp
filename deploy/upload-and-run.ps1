# NEYA ERP — upload + déploiement VPS OVH (une commande)
# Usage:
#   $env:NEYA_VPS_PASSWORD = "votre-mot-de-passe-ovh"
#   .\deploy\upload-and-run.ps1
# Ou sans variable: le script demandera le mot de passe
param(
  [string]$VpsHost = '51.222.31.75',
  [string]$User = 'ubuntu',
  [string]$RemoteDir = '/opt/neya-erp'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$Zip = Join-Path $PSScriptRoot 'neya-erp-deploy.zip'

# 1. Créer l'archive
& (Join-Path $PSScriptRoot 'pack-for-vps.ps1')

# 2. Module SSH
if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
  Write-Host 'Installation Posh-SSH...'
  Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue
  Install-Module -Name Posh-SSH -Force -Scope CurrentUser -AllowClobber
}
Import-Module Posh-SSH

# 3. Mot de passe
$plain = $env:NEYA_VPS_PASSWORD
if (-not $plain) {
  $sec = Read-Host "Mot de passe SSH pour ${User}@${VpsHost}" -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  )
}
$cred = New-Object System.Management.Automation.PSCredential($User, (ConvertTo-SecureString $plain -AsPlainText -Force))

Write-Host "Connexion SSH $User@$VpsHost ..."
$session = New-SSHSession -ComputerName $VpsHost -Credential $cred -AcceptKey -ErrorAction Stop

function Invoke-Remote($cmd) {
  $r = Invoke-SSHCommand -SessionId $session.SessionId -Command $cmd -TimeOut 600
  if ($r.Output) { $r.Output | ForEach-Object { Write-Host $_ } }
  if ($r.Error) { $r.Error | ForEach-Object { Write-Warning $_ } }
  if ($r.ExitStatus -ne 0) { throw "Commande échouée ($($r.ExitStatus)): $cmd" }
  return $r
}

Write-Host 'Preparation repertoire distant...'
Invoke-Remote "sudo mkdir -p $RemoteDir /tmp/neya-upload && sudo chown -R ${User}:${User} $RemoteDir /tmp/neya-upload && ls -la /tmp/neya-upload"

Write-Host 'Upload archive...'
Set-SCPItem -ComputerName $VpsHost -Credential $cred -Path $Zip -Destination '/tmp/neya-upload/' -AcceptKey

Write-Host 'Upload bootstrap script...'
$bootstrap = Join-Path $PSScriptRoot 'remote-bootstrap.sh'
Set-SCPItem -ComputerName $VpsHost -Credential $cred -Path $bootstrap -Destination '/tmp/neya-upload/' -AcceptKey

Write-Host 'Extraction + config + deploiement (10-20 min)...'
$r = Invoke-SSHCommand -SessionId $session.SessionId -Command "sed -i 's/\r$//' /tmp/neya-upload/remote-bootstrap.sh && chmod +x /tmp/neya-upload/remote-bootstrap.sh && bash /tmp/neya-upload/remote-bootstrap.sh $User" -TimeOut 1800
if ($r.Output) { $r.Output | ForEach-Object { Write-Host $_ } }
if ($r.Error) { $r.Error | ForEach-Object { Write-Warning $_ } }
if ($r.ExitStatus -ne 0) { throw "Deploiement echoue (code $($r.ExitStatus))" }

Remove-SSHSession -SessionId $session.SessionId | Out-Null

Write-Host ''
Write-Host '=== Terminé ==='
Write-Host 'ERP: http://51.222.31.75'
Write-Host 'Health: http://51.222.31.75/health'
Write-Host 'Éditez sur le VPS: nano /opt/neya-erp/.env.production (domaine, Claude, admin)'
