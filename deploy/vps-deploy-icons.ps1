Import-Module Posh-SSH
$pass = ConvertTo-SecureString $env:NEYA_VPS_PASSWORD -AsPlainText -Force
$cred = New-Object PSCredential('ubuntu', $pass)
$s = New-SSHSession -ComputerName '51.222.31.75' -Credential $cred -AcceptKey

Invoke-SSHCommand -SessionId $s.SessionId -Command 'mkdir -p /tmp/neya-icons/brand && sudo chown -R ubuntu:ubuntu /opt/neya-erp/frontend/public /opt/neya-erp/frontend/app' -TimeOut 30 | Out-Null

$items = @(
  @{ Local = '..\frontend\public\brand\apple-touch-icon.png'; Dest = '/tmp/neya-icons/brand/' },
  @{ Local = '..\frontend\public\brand\icon-192.png'; Dest = '/tmp/neya-icons/brand/' },
  @{ Local = '..\frontend\public\brand\icon-512.png'; Dest = '/tmp/neya-icons/brand/' },
  @{ Local = '..\frontend\public\brand\favicon-16.png'; Dest = '/tmp/neya-icons/brand/' },
  @{ Local = '..\frontend\public\brand\favicon-32.png'; Dest = '/tmp/neya-icons/brand/' },
  @{ Local = '..\frontend\public\favicon.ico'; Dest = '/tmp/neya-icons/' },
  @{ Local = '..\frontend\public\site.webmanifest'; Dest = '/tmp/neya-icons/' },
  @{ Local = '..\frontend\app\layout.js'; Dest = '/tmp/neya-icons/' }
)

foreach ($f in $items) {
  $p = Resolve-Path (Join-Path $PSScriptRoot $f.Local)
  Set-SCPItem -ComputerName '51.222.31.75' -Credential $cred -Path $p -Destination $f.Dest -AcceptKey
  Write-Host "OK $(Split-Path $f.Local -Leaf)"
}

$cmd = 'sudo cp /tmp/neya-icons/brand/*.png /opt/neya-erp/frontend/public/brand/ && sudo cp /tmp/neya-icons/favicon.ico /tmp/neya-icons/site.webmanifest /opt/neya-erp/frontend/public/ && sudo cp /tmp/neya-icons/layout.js /opt/neya-erp/frontend/app/ && sudo chown -R ubuntu:ubuntu /opt/neya-erp/frontend/public /opt/neya-erp/frontend/app && cd /opt/neya-erp && sudo docker compose -f docker-compose.prod.yml --env-file .env.production build frontend && sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d frontend && sleep 10 && curl -sI http://localhost/brand/apple-touch-icon.png | head -n 8 && curl -sI http://localhost/site.webmanifest | head -n 8'
$r = Invoke-SSHCommand -SessionId $s.SessionId -Command $cmd -TimeOut 600
$r.Output | ForEach-Object { Write-Host $_ }
$r.Error | ForEach-Object { Write-Warning $_ }
Write-Host "EXIT:$($r.ExitStatus)"
Remove-SSHSession -SessionId $s.SessionId | Out-Null
