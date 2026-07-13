Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey
$cmd = 'cd /opt/neya-erp; sleep 5; sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -U neya -d neya_db -c "SELECT key, value FROM app_settings WHERE key = ''anthropic_model'';"; TOKEN=$(sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend node -e "fetch(\"http://localhost:4000/api/auth/login\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({email:\"admin@neya.local\",password:\"neyha31250\"})}).then(r=>r.json()).then(d=>console.log(d.token))"); echo TOKEN_OK; sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend node -e "const t=process.argv[1]; const f=new FormData(); f.append(\"message\",\"Dis bonjour en une phrase courte\"); fetch(\"http://localhost:4000/api/assistant/chat\",{method:\"POST\",headers:{Authorization:\"Bearer \"+t},body:f}).then(async r=>{console.log(\"STATUS\",r.status); console.log(await r.text())})" "$TOKEN"; sudo docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=20 backend'
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 120
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Remove-SSHSession -SessionId $s.SessionId | Out-Null
