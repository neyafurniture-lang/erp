Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

$cmd = 'cd /opt/neya-erp; echo "=== ENV ADMIN ==="; grep -E "ADMIN_PASSWORD|JWT_SECRET|FRONTEND_URL|NODE_ENV" .env.production | sed "s/=.*/=***/"; echo "=== BACKEND LOGS ==="; sudo docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=40 backend; echo "=== LOGIN TEST ==="; curl -s -X POST http://localhost/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@neya.local\",\"password\":\"neyha31250\"}"; echo; curl -s -X POST http://localhost:4000/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@neya.local\",\"password\":\"neyha31250\"}" 2>/dev/null; echo; echo "=== USERS ==="; sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -U neya -d neya_db -c "SELECT id,email,role,active,LEFT(password_hash,20) AS hash FROM users;"'

$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 120
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Remove-SSHSession -SessionId $s.SessionId | Out-Null
