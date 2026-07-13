Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot '..\backend\src\services\ai-chat.js')) -Destination '/opt/neya-erp/backend/src/services/' -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot '..\backend\src\services\settings.js')) -Destination '/opt/neya-erp/backend/src/services/' -AcceptKey

$cmd = 'cd /opt/neya-erp && sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -U neya -d neya_db -c "UPDATE app_settings SET value = ''\"claude-sonnet-5\"''::jsonb, updated_at = NOW() WHERE key = ''anthropic_model''; INSERT INTO app_settings (key, value) SELECT ''anthropic_model'', ''\"claude-sonnet-5\"''::jsonb WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = ''anthropic_model'');" && sudo docker compose -f docker-compose.prod.yml --env-file .env.production build backend && sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend && sleep 10 && TOKEN=$(curl -s -X POST http://localhost/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@neya.local\",\"password\":\"neyha31250\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)[\"token\"])") && curl -s -X POST http://localhost/api/assistant/chat -H "Authorization: Bearer $TOKEN" -F "message=Dis bonjour en une phrase courte" && echo && sudo docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=15 backend'
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 600
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId | Out-Null
