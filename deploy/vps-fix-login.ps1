Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot '..\backend\src\db\schema.sql')) -Destination '/opt/neya-erp/backend/src/db/' -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot '..\backend\src\db\init.js')) -Destination '/opt/neya-erp/backend/src/db/' -AcceptKey

$cmd = 'cd /opt/neya-erp && sudo docker compose -f docker-compose.prod.yml --env-file .env.production build backend && sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend && sleep 12 && sudo docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=30 backend && echo ---LOGIN--- && curl -s -X POST http://localhost/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@neya.local\",\"password\":\"neyha31250\"}" && echo && sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -U neya -d neya_db -c "SELECT id,email,role,active FROM users;"'
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 600
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId | Out-Null
exit $r.ExitStatus
