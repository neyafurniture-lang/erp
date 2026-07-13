# Convertit /opt/neya-erp (fichiers uploadés) en dépôt Git lié à origin, sans perdre .env.production
param(
  [Parameter(Mandatory = $true)]
  [string]$RepoUrl,
  [string]$HostName = '51.222.31.75',
  [string]$User = 'ubuntu',
  [string]$Branch = 'main',
  [string]$RemotePath = '/opt/neya-erp'
)

$ErrorActionPreference = 'Stop'
Import-Module Posh-SSH

if (-not $env:NEYA_VPS_PASSWORD) {
  Write-Error 'Définissez NEYA_VPS_PASSWORD'
}

$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential($User, $pass)

Write-Host "Connexion $User@$HostName ..."
$s = New-SSHSession -ComputerName $HostName -Credential $cred -AcceptKey

$cmd = @"
set -euo pipefail
REPO='$RepoUrl'
BRANCH='$Branch'
DIR='$RemotePath'
TMP="/tmp/neya-git-init-\$\$"

if [[ -d "\$DIR/.git" ]]; then
  echo "Déjà un dépôt Git — mise à jour du remote"
  cd "\$DIR"
  git remote remove origin 2>/dev/null || true
  git remote add origin "\$REPO"
  git fetch origin "\$BRANCH"
  echo "OK remote=origin"
  git remote -v
  exit 0
fi

echo "Sauvegarde .env.production et dossiers sensibles..."
ENV_BAK=\$(mktemp)
if [[ -f "\$DIR/.env.production" ]]; then
  cp "\$DIR/.env.production" "\$ENV_BAK"
fi

# Clone à côté puis bascule (garde Docker volumes via compose)
sudo mkdir -p "\$TMP"
sudo chown -R \$USER:\$USER "\$TMP"
git clone --branch "\$BRANCH" "\$REPO" "\$TMP/repo"

# Conserve secrets et uploads
if [[ -f "\$ENV_BAK" ]]; then
  cp "\$ENV_BAK" "\$TMP/repo/.env.production"
  rm -f "\$ENV_BAK"
fi
if [[ -d "\$DIR/backend/uploads" ]]; then
  mkdir -p "\$TMP/repo/backend/uploads"
  cp -a "\$DIR/backend/uploads/." "\$TMP/repo/backend/uploads/" 2>/dev/null || true
fi
if [[ -d "\$DIR/deploy/backups" ]]; then
  mkdir -p "\$TMP/repo/deploy/backups"
  cp -a "\$DIR/deploy/backups/." "\$TMP/repo/deploy/backups/" 2>/dev/null || true
fi

# Remplace le code en place (sans toucher aux volumes Docker)
cd "\$DIR"
# Arrêt soft pour éviter fichiers verrouillés
sudo docker compose -f docker-compose.prod.yml --env-file .env.production stop backend frontend 2>/dev/null || true

# Swap contenu (garde le même chemin pour docker compose)
sudo rsync -a --delete \
  --exclude '.env.production' \
  --exclude 'backend/uploads' \
  --exclude 'deploy/backups' \
  --exclude 'deploy/logs' \
  --exclude 'deploy/exports' \
  "\$TMP/repo/" "\$DIR/"

if [[ -f "\$TMP/repo/.env.production" ]]; then
  sudo cp "\$TMP/repo/.env.production" "\$DIR/.env.production"
fi
sudo chown -R \$USER:\$USER "\$DIR"
chmod +x "\$DIR"/deploy/*.sh "\$DIR"/back.sh 2>/dev/null || true
rm -rf "\$TMP"

cd "\$DIR"
git remote -v
git status -sb | head -5
echo "=== Git branché. Lancez: ./deploy/deploy.sh ==="
"@

$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 600
$r.Output | ForEach-Object { Write-Host $_ }
if ($r.Error) { $r.Error | ForEach-Object { Write-Warning $_ } }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId | Out-Null
