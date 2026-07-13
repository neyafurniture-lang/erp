Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command 'cd /opt/neya-erp && sudo docker compose -f docker-compose.prod.yml --env-file .env.production ps && sudo docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=80 backend' -TimeOut 120
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Remove-SSHSession -SessionId $s.SessionId
