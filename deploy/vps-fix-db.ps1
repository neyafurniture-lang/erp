Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

$cmd = 'cd /opt/neya-erp; sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend node src/db/init.js; echo INIT_EXIT:$?; sudo docker compose -f docker-compose.prod.yml --env-file .env.production restart backend; sleep 8; sudo docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=20 backend; echo ---; curl -s -X POST http://localhost/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@neya.local\",\"password\":\"neyha31250\"}"; echo; sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -U neya -d neya_db -c "SELECT id,email,role,active FROM users;"'

$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 180
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Remove-SSHSession -SessionId $s.SessionId | Out-Null
