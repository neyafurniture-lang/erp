# Rollback d'urgence sur le VPS : restaure backup DB + commit précédent
# Usage : .\deploy\vps-back.ps1
#         .\deploy\vps-back.ps1 -Yes
param(
  [string]$VpsHost = $(if ($env:NEYA_VPS_HOST) { $env:NEYA_VPS_HOST } else { '51.222.31.75' }),
  [string]$User = 'ubuntu',
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$confirm = if ($Yes) { 'BACK_CONFIRM=1' } else { 'BACK_CONFIRM=0' }
$cmd = "$confirm /opt/neya-erp/deploy/back.sh"

Write-Host ">> Rollback NEYA sur $User@${VpsHost}"
Write-Host ">> $cmd"
Write-Host ""

ssh "${User}@${VpsHost}" $cmd

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host ">> Terminé. Vérifiez : https://erp.neyafurniture.ca/health"
} else {
  Write-Error "Rollback échoué (code $LASTEXITCODE)"
}
