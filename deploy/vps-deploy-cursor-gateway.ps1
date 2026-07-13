# Déploie la passerelle Cursor + init Git sur /opt/neya-erp
$ErrorActionPreference = 'Stop'
Import-Module Posh-SSH

if (-not $env:NEYA_VPS_PASSWORD) { throw 'NEYA_VPS_PASSWORD requis' }

$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$root = Split-Path $PSScriptRoot -Parent

$files = @(
  @{ L = "$root\backend\src\services\cursor-agent.js"; D = '/opt/neya-erp/backend/src/services/' },
  @{ L = "$root\backend\src\services\cursor-git-gateway.js"; D = '/opt/neya-erp/backend/src/services/' },
  @{ L = "$root\backend\src\routes\cursor-agent.js"; D = '/opt/neya-erp/backend/src/routes/' },
  @{ L = "$root\backend\Dockerfile"; D = '/opt/neya-erp/backend/' },
  @{ L = "$root\docker-compose.prod.yml"; D = '/opt/neya-erp/' },
  @{ L = "$root\frontend\components\CursorAgentPanel.js"; D = '/opt/neya-erp/frontend/components/' },
  @{ L = "$root\.gitignore"; D = '/opt/neya-erp/' }
)

foreach ($f in $files) {
  Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path $f.L -Destination $f.D -AcceptKey
  Write-Host "OK $($f.L)"
}

$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey
$cmd = @'
set -euo pipefail
cd /opt/neya-erp

# Init Git workspace si absent (backups Cursor)
if [[ ! -d .git ]]; then
  git init -b main
  git config user.email "cursor-agent@neya.local"
  git config user.name "NEYA Cursor Agent"
  # ne pas committer .env.production
  git add -A
  git reset -- .env.production 2>/dev/null || true
  git commit -m "chore: baseline VPS pour passerelle Cursor" --allow-empty || true
  echo "Git init OK"
else
  echo "Git déjà présent"
fi

# Ownership Docker ≠ host : requis pour backups Cursor dans le container
sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend \
  git config --global --add safe.directory /workspace 2>/dev/null || true


mkdir -p deploy/backups/cursor
chmod +x deploy/*.sh 2>/dev/null || true

# Rebuild backend (git + mount workspace) + frontend (UI)
sudo docker compose -f docker-compose.prod.yml --env-file .env.production build backend frontend
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend frontend
sleep 15
curl -s http://127.0.0.1/health | head -c 300 || true
echo
sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T backend \
  node -e "import('fs').then(fs=>console.log('workspace',fs.existsSync('/workspace'),'git',fs.existsSync('/workspace/.git')))"
'@

$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 900
$r.Output | ForEach-Object { Write-Host $_ }
if ($r.Error) { $r.Error | ForEach-Object { Write-Warning $_ } }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId | Out-Null
