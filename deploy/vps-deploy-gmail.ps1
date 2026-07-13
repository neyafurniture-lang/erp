Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$root = Split-Path $PSScriptRoot -Parent

$files = @(
  @{ local = "$root\backend\src\services\settings.js"; remote = '/opt/neya-erp/backend/src/services/' },
  @{ local = "$root\backend\src\services\google-oauth.js"; remote = '/opt/neya-erp/backend/src/services/' },
  @{ local = "$root\backend\src\routes\integrations.js"; remote = '/opt/neya-erp/backend/src/routes/' },
  @{ local = "$root\frontend\app\settings\page.js"; remote = '/opt/neya-erp/frontend/app/settings/' },
  @{ local = "$root\frontend\components\GmailInbox.js"; remote = '/opt/neya-erp/frontend/components/' }
)

foreach ($f in $files) {
  Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path $f.local -Destination $f.remote -AcceptKey
}

$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey
$cmd = @'
cd /opt/neya-erp
sudo docker compose -f docker-compose.prod.yml --env-file .env.production build backend frontend
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend frontend
sleep 8
curl -s http://localhost/health
'@
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 600
$r.Output | Select-Object -Last 20
Remove-SSHSession -SessionId $s.SessionId | Out-Null
Write-Host 'Deploy Gmail OAuth terminé.'
