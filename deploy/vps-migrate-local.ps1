Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)

$root = Split-Path $PSScriptRoot -Parent
$sqlLocal = Join-Path $root 'backend\scripts\migration-export.sql'

Write-Host '>> Export local DB...'
Push-Location (Join-Path $root 'backend')
npm run db:migrate-export
Pop-Location

Write-Host '>> Upload SQL...'
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path $sqlLocal -Destination '/opt/neya-erp/migration-export.sql' -AcceptKey

$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey
$cmd = @'
cd /opt/neya-erp
echo === IMPORT ===
sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -U neya -d neya_db -v ON_ERROR_STOP=1 -f - < migration-export.sql
echo === COUNTS ===
sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -U neya -d neya_db -c "
SELECT 'clients' t, count(*)::text c FROM clients
UNION ALL SELECT 'projects', count(*)::text FROM projects
UNION ALL SELECT 'tasks', count(*)::text FROM tasks
UNION ALL SELECT 'purchase_needs', count(*)::text FROM purchase_needs;
"
echo === CLIENTS ===
sudo docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -U neya -d neya_db -c "SELECT id,name FROM clients ORDER BY id;"
'@

$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 180
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Remove-SSHSession -SessionId $s.SessionId | Out-Null

Write-Host '>> Deploy frontend (liste-courses)...'
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Join-Path $root 'frontend\app\liste-courses\page.js') -Destination '/opt/neya-erp/frontend/app/liste-courses/' -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Join-Path $root 'frontend\app\purchases\page.js') -Destination '/opt/neya-erp/frontend/app/purchases/' -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Join-Path $root 'frontend\components\Sidebar.js') -Destination '/opt/neya-erp/frontend/components/' -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Join-Path $root 'frontend\components\MobileNav.js') -Destination '/opt/neya-erp/frontend/components/' -AcceptKey

$s2 = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey
$build = 'cd /opt/neya-erp && sudo docker compose -f docker-compose.prod.yml --env-file .env.production build frontend && sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d frontend'
$r2 = Invoke-SSHCommand -SessionId $s2.SessionId -Command $build -TimeOut 600
$r2.Output | Select-Object -Last 15 | ForEach-Object { Write-Host $_ }
Remove-SSHSession -SessionId $s2.SessionId | Out-Null
Write-Host '>> Terminé.'
