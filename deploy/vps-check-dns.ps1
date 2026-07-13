Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey
$cmd = 'echo "=== ENV ==="; grep -E "ERP_DOMAIN|FRONTEND_URL|NEXT_PUBLIC|ACME|GOOGLE_REDIRECT" /opt/neya-erp/.env.production; echo "=== CADDYFILE ==="; cat /opt/neya-erp/deploy/Caddyfile; echo "=== DNS erp ==="; getent hosts erp.neyafurniture.ca || true; dig +short erp.neyafurniture.ca A 2>/dev/null || nslookup erp.neyafurniture.ca 2>/dev/null | head -20; echo "=== PORTS ==="; sudo ss -tlnp | grep -E ":80|:443" || true'
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 60
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Remove-SSHSession -SessionId $s.SessionId | Out-Null
