Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

Invoke-SSHCommand -SessionId $s.SessionId -Command 'mkdir -p /tmp/neya-ui/services /tmp/neya-ui/routes /tmp/neya-ui/db /tmp/neya-ui/components /tmp/neya-ui/app' -TimeOut 20 | Out-Null

$files = @(
  @{ L='..\backend\src\services\ui-layout.js'; D='/tmp/neya-ui/services/' },
  @{ L='..\backend\src\services\skill-actions.js'; D='/tmp/neya-ui/services/' },
  @{ L='..\backend\src\services\assistant.js'; D='/tmp/neya-ui/services/' },
  @{ L='..\backend\src\routes\ui.js'; D='/tmp/neya-ui/routes/' },
  @{ L='..\backend\src\routes\dashboard.js'; D='/tmp/neya-ui/routes/' },
  @{ L='..\backend\src\index.js'; D='/tmp/neya-ui/' },
  @{ L='..\backend\src\db\init.js'; D='/tmp/neya-ui/db/' },
  @{ L='..\frontend\components\EditableSection.js'; D='/tmp/neya-ui/components/' },
  @{ L='..\frontend\app\page.js'; D='/tmp/neya-ui/app/' }
)
foreach ($f in $files) {
  Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot $f.L)) -Destination $f.D -AcceptKey
  Write-Host "OK $($f.L)"
}

$cmd = 'sudo cp /tmp/neya-ui/services/* /opt/neya-erp/backend/src/services/ && sudo cp /tmp/neya-ui/routes/ui.js /opt/neya-erp/backend/src/routes/ && sudo cp /tmp/neya-ui/routes/dashboard.js /opt/neya-erp/backend/src/routes/ && sudo cp /tmp/neya-ui/index.js /opt/neya-erp/backend/src/index.js && sudo cp /tmp/neya-ui/db/init.js /opt/neya-erp/backend/src/db/init.js && sudo cp /tmp/neya-ui/components/EditableSection.js /opt/neya-erp/frontend/components/ && sudo cp /tmp/neya-ui/app/page.js /opt/neya-erp/frontend/app/page.js && cd /opt/neya-erp && sudo docker compose -f docker-compose.prod.yml --env-file .env.production build backend frontend && sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d && sleep 18 && sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend node -e "import(\"./src/db/init.js\").then(m=>m.initDb()).then(()=>console.log(\"init ok\")).catch(e=>console.error(e))" && TOKEN=$(sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend node -e "fetch(\"http://localhost:4000/api/auth/login\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},body:JSON.stringify({email:\"admin@neya.local\",password:\"neyha31250\"})}).then(r=>r.json()).then(d=>console.log(d.token))") && curl -s http://127.0.0.1/api/ui/dashboard-layout -H "Authorization: Bearer $TOKEN" | head -c 200 && echo'
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 900
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId | Out-Null
