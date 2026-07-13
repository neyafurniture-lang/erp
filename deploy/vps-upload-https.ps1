Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Join-Path $PSScriptRoot 'enable-https.sh') -Destination '/tmp/neya-upload/' -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Join-Path $PSScriptRoot 'HTTPS.md') -Destination '/tmp/neya-upload/' -AcceptKey
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command "sed -i 's/\r$//' /tmp/neya-upload/enable-https.sh; sudo cp /tmp/neya-upload/enable-https.sh /opt/neya-erp/deploy/; sudo chmod +x /opt/neya-erp/deploy/enable-https.sh; sudo cp /tmp/neya-upload/HTTPS.md /opt/neya-erp/deploy/; ls -la /opt/neya-erp/deploy/enable-https.sh" -TimeOut 30
$r.Output
Remove-SSHSession -SessionId $s.SessionId | Out-Null
