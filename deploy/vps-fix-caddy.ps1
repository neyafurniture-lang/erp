Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Join-Path $PSScriptRoot 'Caddyfile') -Destination '/opt/neya-erp/deploy/' -AcceptKey
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command 'cd /opt/neya-erp && sudo docker compose -f docker-compose.prod.yml --env-file .env.production restart caddy && sleep 3 && curl -s http://localhost/health' -TimeOut 60
$r.Output
Remove-SSHSession -SessionId $s.SessionId
