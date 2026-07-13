Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

Invoke-SSHCommand -SessionId $s.SessionId -Command 'mkdir -p /tmp/neya-login' -TimeOut 15 | Out-Null

Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot '..\frontend\app\login\page.js')) -Destination '/tmp/neya-login/' -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot '..\backend\src\middleware\security.js')) -Destination '/tmp/neya-login/' -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot '..\backend\src\index.js')) -Destination '/tmp/neya-login/' -AcceptKey

$cmd = 'sudo cp /tmp/neya-login/page.js /opt/neya-erp/frontend/app/login/page.js && sudo cp /tmp/neya-login/security.js /opt/neya-erp/backend/src/middleware/security.js && sudo cp /tmp/neya-login/index.js /opt/neya-erp/backend/src/index.js && cd /opt/neya-erp && sudo docker compose -f docker-compose.prod.yml --env-file .env.production build backend frontend && sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend frontend && sleep 15 && curl -s -X POST http://127.0.0.1/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@neya.local\",\"password\":\"neyha31250\"}" | head -c 120 && echo && curl -sI http://127.0.0.1/api/auth/me | head -n 15'
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 900
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId | Out-Null
