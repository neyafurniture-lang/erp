Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey
Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path (Join-Path $PSScriptRoot 'remote-clean-chat.sh') -Destination '/tmp/neya-upload/' -AcceptKey
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command "sed -i 's/\r$//' /tmp/neya-upload/remote-clean-chat.sh; bash /tmp/neya-upload/remote-clean-chat.sh" -TimeOut 90
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Remove-SSHSession -SessionId $s.SessionId | Out-Null
