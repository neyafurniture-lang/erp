Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

$cmd = 'cd /opt/neya-erp; echo "=== ENV ==="; grep -E "FRONTEND_URL|NEXT_PUBLIC|ERP_DOMAIN|NODE_ENV|JWT" .env.production | sed "s/JWT_SECRET=.*/JWT_SECRET=***/"; echo "=== LOGIN VIA CADDY ==="; curl -s -w "\nHTTP:%{http_code}\n" -X POST http://127.0.0.1/api/auth/login -H "Content-Type: application/json" -H "Origin: http://51.222.31.75" -d "{\"email\":\"admin@neya.local\",\"password\":\"neyha31250\"}"; echo; echo "=== LOGIN BACKEND DIRECT ==="; sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend node -e "fetch(\"http://localhost:4000/api/auth/login\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({email:\"admin@neya.local\",password:\"neyha31250\"})}).then(async r=>console.log(r.status, await r.text()))"; echo "=== CORS/FRONTEND ==="; sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend printenv FRONTEND_URL NODE_ENV; echo "=== LOGS ==="; sudo docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=25 backend; echo "=== FRONT api.js snippet ==="; grep -n "getApiUrl\|location.origin\|NEXT_PUBLIC" frontend/lib/api.js | head -30'

$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 90
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Remove-SSHSession -SessionId $s.SessionId | Out-Null
