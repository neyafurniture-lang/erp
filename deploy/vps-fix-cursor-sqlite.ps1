Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

Invoke-SSHCommand -SessionId $s.SessionId -Command 'mkdir -p /tmp/neya-fix/services /tmp/neya-fix/components' -TimeOut 15 | Out-Null

Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot '..\backend\src\services\cursor-agent.js')) -Destination '/tmp/neya-fix/services/' -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot '..\backend\Dockerfile')) -Destination '/tmp/neya-fix/' -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot '..\frontend\components\CursorAgentPanel.js')) -Destination '/tmp/neya-fix/components/' -AcceptKey

$cmd = 'sudo cp /tmp/neya-fix/services/cursor-agent.js /opt/neya-erp/backend/src/services/ && sudo cp /tmp/neya-fix/Dockerfile /opt/neya-erp/backend/Dockerfile && sudo cp /tmp/neya-fix/components/CursorAgentPanel.js /opt/neya-erp/frontend/components/ && cd /opt/neya-erp && sudo docker compose -f docker-compose.prod.yml --env-file .env.production build backend frontend && sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend frontend && sleep 18 && sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend node -e "console.log(process.version)" && sudo docker compose -f docker-compose.prod.yml --env-file .env.production ps'
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 1200
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId | Out-Null
