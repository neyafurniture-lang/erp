# Installe Node + runner Cursor Agent sur l'hôte Ubuntu (hors Docker)
$ErrorActionPreference = 'Stop'
Import-Module Posh-SSH

if (-not $env:NEYA_VPS_PASSWORD) { throw 'NEYA_VPS_PASSWORD requis' }

$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$root = Split-Path $PSScriptRoot -Parent

# Token partagé ERP ↔ runner hôte
$token = -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })

$files = @(
  @{ L = "$root\deploy\cursor-host-runner\package.json"; D = '/opt/neya-erp/deploy/cursor-host-runner/' },
  @{ L = "$root\deploy\cursor-host-runner\server.mjs"; D = '/opt/neya-erp/deploy/cursor-host-runner/' },
  @{ L = "$root\deploy\cursor-host-runner\neya-cursor-agent.service"; D = '/opt/neya-erp/deploy/cursor-host-runner/' },
  @{ L = "$root\backend\src\services\cursor-agent.js"; D = '/opt/neya-erp/backend/src/services/' },
  @{ L = "$root\docker-compose.prod.yml"; D = '/opt/neya-erp/' },
  @{ L = "$root\frontend\components\CursorAgentPanel.js"; D = '/opt/neya-erp/frontend/components/' }
)

$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey
Invoke-SSHCommand -SessionId $s.SessionId -Command 'mkdir -p /opt/neya-erp/deploy/cursor-host-runner /opt/neya-erp/deploy/run' -TimeOut 15 | Out-Null

foreach ($f in $files) {
  Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path $f.L -Destination $f.D -AcceptKey
  Write-Host "OK $($f.L)"
}

$cmd = @"
set -euo pipefail
cd /opt/neya-erp

# Token
TOKEN='$token'
mkdir -p deploy/cursor-host-runner deploy/run
printf 'CURSOR_HOST_TOKEN=%s\nCURSOR_AGENT_CWD=/opt/neya-erp\nCURSOR_HOST_SOCKET=/opt/neya-erp/deploy/run/cursor-agent.sock\n' "`$TOKEN" > deploy/cursor-host-runner/.env
chmod 600 deploy/cursor-host-runner/.env

# Injecter token dans .env.production si absent
if ! grep -q '^CURSOR_HOST_TOKEN=' .env.production 2>/dev/null; then
  echo "CURSOR_HOST_TOKEN=`$TOKEN" >> .env.production
  echo "CURSOR_USE_HOST_RUNNER=1" >> .env.production
else
  sed -i "s/^CURSOR_HOST_TOKEN=.*/CURSOR_HOST_TOKEN=`$TOKEN/" .env.production
  grep -q '^CURSOR_USE_HOST_RUNNER=' .env.production || echo 'CURSOR_USE_HOST_RUNNER=1' >> .env.production
fi

# Node 22 sur l'hôte
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v
npm -v

cd deploy/cursor-host-runner
npm install --omit=dev

# systemd
sudo cp /opt/neya-erp/deploy/cursor-host-runner/neya-cursor-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable neya-cursor-agent
sudo systemctl restart neya-cursor-agent
sleep 2
sudo systemctl --no-pager status neya-cursor-agent | head -20
ls -la /opt/neya-erp/deploy/run/ || true

# Rebuild backend + frontend pour socket + UI
cd /opt/neya-erp
sudo docker compose -f docker-compose.prod.yml --env-file .env.production build backend frontend
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend frontend
sleep 12

# Vérifs
echo '=== host info via socket ==='
sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend \
  node -e "
import http from 'http';
import fs from 'fs';
const sock='/host-run/cursor-agent.sock';
console.log('sock exists', fs.existsSync(sock));
const req=http.request({socketPath:sock,path:'/info',method:'GET'},res=>{
  let d=''; res.on('data',c=>d+=c); res.on('end',()=>console.log(d));
});
req.on('error',e=>{console.error('ERR',e.message); process.exit(1);});
req.end();
"
"@

$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 900
$r.Output | ForEach-Object { Write-Host $_ }
if ($r.Error) { $r.Error | ForEach-Object { Write-Warning $_ } }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId | Out-Null
