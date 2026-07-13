Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

Invoke-SSHCommand -SessionId $s.SessionId -Command 'mkdir -p /tmp/neya-speech/services /tmp/neya-speech/routes /tmp/neya-speech/lib /tmp/neya-speech/components /tmp/neya-speech/app' -TimeOut 20 | Out-Null

$map = @(
  @{ L='..\backend\src\services\ai-chat.js'; D='/tmp/neya-speech/services/' },
  @{ L='..\backend\src\services\assistant-plan.js'; D='/tmp/neya-speech/services/' },
  @{ L='..\backend\src\routes\assistant.js'; D='/tmp/neya-speech/routes/' },
  @{ L='..\frontend\lib\useSpeechRecognition.js'; D='/tmp/neya-speech/lib/' },
  @{ L='..\frontend\components\ChatAssistant.js'; D='/tmp/neya-speech/components/' },
  @{ L='..\frontend\components\VoicePlanCard.js'; D='/tmp/neya-speech/components/' },
  @{ L='..\frontend\components\VoiceOrb.js'; D='/tmp/neya-speech/components/' }
)
foreach ($m in $map) {
  Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot $m.L)) -Destination $m.D -AcceptKey
  Write-Host "OK $($m.L)"
}

$cmd = 'sudo cp /tmp/neya-speech/services/* /opt/neya-erp/backend/src/services/ && sudo cp /tmp/neya-speech/routes/assistant.js /opt/neya-erp/backend/src/routes/ && sudo cp /tmp/neya-speech/lib/useSpeechRecognition.js /opt/neya-erp/frontend/lib/ && sudo cp /tmp/neya-speech/components/* /opt/neya-erp/frontend/components/ && cd /opt/neya-erp && sudo docker compose -f docker-compose.prod.yml --env-file .env.production build backend frontend && sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend frontend && sleep 15 && sudo docker compose -f docker-compose.prod.yml --env-file .env.production ps'
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 900
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId | Out-Null
