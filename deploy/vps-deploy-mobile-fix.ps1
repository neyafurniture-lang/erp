Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

Invoke-SSHCommand -SessionId $s.SessionId -Command 'mkdir -p /tmp/neya-mobile' -TimeOut 20 | Out-Null

$files = @(
  @{ Local = '..\frontend\lib\api.js'; Dest = '/tmp/neya-mobile/api.js' },
  @{ Local = '..\frontend\lib\auth-context.js'; Dest = '/tmp/neya-mobile/auth-context.js' },
  @{ Local = '..\frontend\components\AuthGuard.js'; Dest = '/tmp/neya-mobile/AuthGuard.js' },
  @{ Local = '..\frontend\app\globals.css'; Dest = '/tmp/neya-mobile/globals.css' },
  @{ Local = '..\frontend\app\layout.js'; Dest = '/tmp/neya-mobile/layout.js' }
)
foreach ($f in $files) {
  Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Resolve-Path (Join-Path $PSScriptRoot $f.Local)) -Destination '/tmp/neya-mobile/' -AcceptKey
  Write-Host "OK $($f.Local)"
}

$cmd = @'
sudo cp /tmp/neya-mobile/api.js /opt/neya-erp/frontend/lib/api.js
sudo cp /tmp/neya-mobile/auth-context.js /opt/neya-erp/frontend/lib/auth-context.js
sudo cp /tmp/neya-mobile/AuthGuard.js /opt/neya-erp/frontend/components/AuthGuard.js
sudo cp /tmp/neya-mobile/globals.css /opt/neya-erp/frontend/app/globals.css
sudo cp /tmp/neya-mobile/layout.js /opt/neya-erp/frontend/app/layout.js
# Forcer API relative dans .env.production pour le prochain build
sudo sed -i 's|^NEXT_PUBLIC_API_URL=.*|NEXT_PUBLIC_API_URL=/api|' /opt/neya-erp/.env.production
grep NEXT_PUBLIC_API_URL /opt/neya-erp/.env.production
cd /opt/neya-erp
sudo docker compose -f docker-compose.prod.yml --env-file .env.production build frontend
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d frontend
sleep 12
sudo docker compose -f docker-compose.prod.yml --env-file .env.production ps frontend
'@

$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 600
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId | Out-Null
