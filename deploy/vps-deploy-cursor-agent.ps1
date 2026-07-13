Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

Invoke-SSHCommand -SessionId $s.SessionId -Command 'mkdir -p /tmp/neya-cursor/services /tmp/neya-cursor/routes /tmp/neya-cursor/components /tmp/neya-cursor/app /tmp/neya-cursor/css' -TimeOut 20 | Out-Null

$files = @(
  @{ L='..\backend\src\services\cursor-agent.js'; D='/tmp/neya-cursor/services/' },
  @{ L='..\backend\src\services\settings.js'; D='/tmp/neya-cursor/services/' },
  @{ L='..\backend\src\routes\cursor-agent.js'; D='/tmp/neya-cursor/routes/' },
  @{ L='..\backend\src\index.js'; D='/tmp/neya-cursor/' },
  @{ L='..\backend\package.json'; D='/tmp/neya-cursor/' },
  @{ L='..\backend\package-lock.json'; D='/tmp/neya-cursor/' },
  @{ L='..\frontend\components\CursorAgentPanel.js'; D='/tmp/neya-cursor/components/' },
  @{ L='..\frontend\components\ChatAssistant.js'; D='/tmp/neya-cursor/components/' },
  @{ L='..\frontend\components\VoiceOrb.js'; D='/tmp/neya-cursor/components/' },
  @{ L='..\frontend\components\ErpRoadmapContent.js'; D='/tmp/neya-cursor/components/' },
  @{ L='..\frontend\app\settings\page.js'; D='/tmp/neya-cursor/app/' },
  @{ L='..\frontend\app\globals.css'; D='/tmp/neya-cursor/css/' }
)
foreach ($f in $files) {
  Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot $f.L)) -Destination $f.D -AcceptKey
  Write-Host "OK $($f.L)"
}

$cmd = 'sudo cp /tmp/neya-cursor/services/* /opt/neya-erp/backend/src/services/ && sudo cp /tmp/neya-cursor/routes/cursor-agent.js /opt/neya-erp/backend/src/routes/ && sudo cp /tmp/neya-cursor/index.js /opt/neya-erp/backend/src/index.js && sudo cp /tmp/neya-cursor/package.json /tmp/neya-cursor/package-lock.json /opt/neya-erp/backend/ && sudo cp /tmp/neya-cursor/components/* /opt/neya-erp/frontend/components/ && sudo cp /tmp/neya-cursor/app/page.js /opt/neya-erp/frontend/app/settings/page.js && sudo cp /tmp/neya-cursor/css/globals.css /opt/neya-erp/frontend/app/globals.css && cd /opt/neya-erp && sudo docker compose -f docker-compose.prod.yml --env-file .env.production build backend frontend && sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend frontend && sleep 20 && sudo docker compose -f docker-compose.prod.yml --env-file .env.production ps'
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 1200
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId | Out-Null
