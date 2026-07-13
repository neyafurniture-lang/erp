Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

& (Join-Path $PSScriptRoot 'pack-for-vps.ps1')
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Join-Path $PSScriptRoot 'neya-erp-deploy.zip') -Destination '/tmp/neya-upload/' -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Join-Path $PSScriptRoot 'remote-bootstrap.sh') -Destination '/tmp/neya-upload/' -AcceptKey

$cmd = "sed -i 's/`r$//' /tmp/neya-upload/remote-bootstrap.sh; chmod +x /tmp/neya-upload/remote-bootstrap.sh; bash /tmp/neya-upload/remote-bootstrap.sh ubuntu"
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 2400
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId
exit $r.ExitStatus
