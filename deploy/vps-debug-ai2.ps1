Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey
$cmd = 'cd /opt/neya-erp; ls -la backend/src/services/ai-chat.js backend/src/services/settings.js 2>&1; sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -U neya -d neya_db -c "SELECT key, LEFT(value::text,60) FROM app_settings WHERE key LIKE ''%ai%'' OR key LIKE ''%anthropic%'' OR key LIKE ''%openai%'' OR key LIKE ''%assistant%'' ORDER BY key;"; TOKEN=$(curl -s -X POST http://localhost/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@neya.local\",\"password\":\"neyha31250\"}" | python3 -c "import sys,json; print(json.load(sys.stdin).get(\"token\",\"\"))" 2>/dev/null || true); echo TOKEN_LEN=${#TOKEN}; curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost/api/assistant/chat -H "Authorization: Bearer $TOKEN" -F "message=Dis bonjour en une phrase"; echo; sudo docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=30 backend'
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 120
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Remove-SSHSession -SessionId $s.SessionId | Out-Null
