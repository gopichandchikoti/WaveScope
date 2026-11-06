$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$listener = Get-NetTCPConnection -State Listen -LocalPort 5182 -ErrorAction SilentlyContinue
if ($listener) { Write-Output 'Port 5182 is already in use. Existing processes were left running.'; exit 1 }
$probe = New-Object System.Net.Sockets.TcpClient
try { $probe.Connect('127.0.0.1', 5182) } catch { }
if ($probe.Connected) { $probe.Dispose(); throw 'Port 5182 is already in use. Existing processes were left running.' }
$probe.Dispose()
$nodePath = (Get-Command node).Source
$entryPath = Join-Path $repoRoot 'server\index.mjs'
$process = Start-Process -FilePath $nodePath -ArgumentList ('"' + $entryPath + '"') -WorkingDirectory $repoRoot -RedirectStandardOutput (Join-Path $repoRoot 'local-server.log') -RedirectStandardError (Join-Path $repoRoot 'local-server.err.log') -WindowStyle Hidden -PassThru
$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $process.Refresh()
    if ($process.HasExited) { throw 'WaveScope did not start. Check whether port 5182 is available.' }
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5182/api/health' -TimeoutSec 1
        if ($health.status -eq 'ok' -and $health.app -eq 'WaveScope') { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 200 }
}
if (!$ready) { throw 'WaveScope did not respond at its health endpoint.' }
@{pid=$process.Id;port=5182;entry=$entryPath} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $repoRoot '.local-server.json')
Write-Output ('WaveScope: http://127.0.0.1:5182 (PID ' + $process.Id + ')')
