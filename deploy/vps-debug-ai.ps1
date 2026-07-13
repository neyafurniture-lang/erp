Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

$cmd = @'
cd /opt/neya-erp
echo "=== SETTINGS AI ==="
sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -U neya -d neya_db -c "SELECT key, LEFT(value::text,80) AS value FROM app_settings WHERE key ILIKE '%ai%' OR key ILIKE '%anthropic%' OR key ILIKE '%openai%' OR key ILIKE '%assistant%' ORDER BY key;"
echo "=== ENV ANTHROPIC ==="
grep -E "ANTHROPIC|OPENAI" .env.production | sed "s/=.*/=***/" || true
echo "=== LOGIN + CHAT ==="
TOKEN=$(curl -s -X POST http://localhost/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@neya.local","password":"neyha31250"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
echo "TOKEN_LEN:${#TOKEN}"
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost/api/assistant/chat -H "Authorization: Bearer $TOKEN" -F "message=Bonjour, dis juste OK en JSON si tu marches"
echo
echo "=== BACKEND LOGS ==="
sudo docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=40 backend
'@

$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 120
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Remove-SSHSession -SessionId $s.SessionId | Out-Null
