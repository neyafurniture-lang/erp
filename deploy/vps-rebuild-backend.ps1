Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot '..\backend\src\index.js')) -Destination '/opt/neya-erp/backend/src/' -AcceptKey

$cmd = 'cd /opt/neya-erp && sudo docker compose -f docker-compose.prod.yml --env-file .env.production build backend && sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d && sleep 20 && sudo docker compose -f docker-compose.prod.yml --env-file .env.production ps && curl -s http://localhost/health'
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 600
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId
exit $r.ExitStatus
