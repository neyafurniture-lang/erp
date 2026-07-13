Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey
$cmd = 'echo VIA_CADDY:; curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@neya.local\",\"password\":\"neyha31250\"}"; echo VIA_BACKEND:; sudo docker compose -f /opt/neya-erp/docker-compose.prod.yml --env-file /opt/neya-erp/.env.production exec -T backend node -e "fetch(\"http://localhost:4000/api/auth/login\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({email:\"admin@neya.local\",password:\"neyha31250\"})}).then(r=>r.text().then(t=>console.log(r.status,t)))"'
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 60
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Remove-SSHSession -SessionId $s.SessionId | Out-Null
