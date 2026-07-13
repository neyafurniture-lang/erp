Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot '..\backend\src\services\skill-actions.js')) -Destination '/opt/neya-erp/backend/src/services/' -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot '..\backend\src\services\assistant.js')) -Destination '/opt/neya-erp/backend/src/services/' -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot '..\backend\src\services\ai-chat.js')) -Destination '/opt/neya-erp/backend/src/services/' -AcceptKey
$cmd = 'cd /opt/neya-erp && sudo docker compose -f docker-compose.prod.yml --env-file .env.production build backend && sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend && sleep 12 && sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend node -e "fetch(\"http://localhost:4000/api/auth/login\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({email:\"admin@neya.local\",password:\"neyha31250\"})}).then(r=>r.json()).then(async d=>{const f=new FormData();f.append(\"message\",\"Liste les projets\");const res=await fetch(\"http://localhost:4000/api/assistant/chat\",{method:\"POST\",headers:{Authorization:\"Bearer \"+d.token},body:f});console.log(await res.text())})"'
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 600
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId | Out-Null
