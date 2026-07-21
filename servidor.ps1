param(
  [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Get-LanIPv4 {
  try {
    $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.PrefixOrigin -ne "WellKnown"
      } |
      Sort-Object -Property InterfaceMetric
    if ($candidates) {
      return @($candidates)[0].IPAddress
    }
  } catch {}

  try {
    $entry = [System.Net.Dns]::GetHostEntry([System.Net.Dns]::GetHostName())
    foreach ($addr in $entry.AddressList) {
      if ($addr.AddressFamily -eq "InterNetwork") {
        $ip = $addr.IPAddressToString
        if ($ip -notlike "127.*" -and $ip -notlike "169.254.*") {
          return $ip
        }
      }
    }
  } catch {}
  return $null
}

function Get-ContentType([string]$ext) {
  switch ($ext.ToLowerInvariant()) {
    ".html" { return "text/html; charset=utf-8" }
    ".htm"  { return "text/html; charset=utf-8" }
    ".js"   { return "application/javascript; charset=utf-8" }
    ".json" { return "application/json; charset=utf-8" }
    ".css"  { return "text/css; charset=utf-8" }
    ".svg"  { return "image/svg+xml" }
    ".png"  { return "image/png" }
    ".ico"  { return "image/x-icon" }
    ".txt"  { return "text/plain; charset=utf-8" }
    default { return "application/octet-stream" }
  }
}

function Send-HttpResponse($stream, [int]$statusCode, [string]$statusText, [string]$contentType, [byte[]]$body) {
  $header = "HTTP/1.1 $statusCode $statusText`r`n" +
    "Content-Type: $contentType`r`n" +
    "Content-Length: $($body.Length)`r`n" +
    "Connection: close`r`n" +
    "Cache-Control: no-store`r`n" +
    "Access-Control-Allow-Origin: *`r`n" +
    "`r`n"
  $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($body.Length -gt 0) {
    $stream.Write($body, 0, $body.Length)
  }
}

$lanIp = Get-LanIPv4

Write-Host "Iniciando servidor en:"
Write-Host "  $root"
Write-Host ""

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)

try {
  $listener.Start()
} catch {
  Write-Host "ERROR: no se pudo abrir el puerto $Port"
  Write-Host $_.Exception.Message
  Write-Host "Cierra otras ventanas de servidor o cambia el puerto."
  exit 1
}

Write-Host "OK - Servidor activo"
Write-Host ""
Write-Host "============================================"
Write-Host "  EN EL IPAD (Safari) ESCRIBE EXACTAMENTE:"
if ($lanIp) {
  Write-Host ("  http://{0}:{1}/" -f $lanIp, $Port) -ForegroundColor Yellow
} else {
  Write-Host "  No se detecto IP. En el PC ejecuta: ipconfig"
  Write-Host "  Busca IPv4 y usa: http://ESA_IP:$Port/"
}
Write-Host "============================================"
Write-Host ""
Write-Host "En esta PC tambien puedes usar:"
Write-Host "  http://127.0.0.1:$Port/"
Write-Host ""
Write-Host "PC e iPad deben estar en la MISMA Wi-Fi."
Write-Host "NO cierres esta ventana."
Write-Host "Ctrl+C para detener"
Write-Host ""

if ($lanIp) {
  try { Set-Clipboard -Value ("http://{0}:{1}/" -f $lanIp, $Port) } catch {}
}

try {
  Start-Process ("http://127.0.0.1:{0}/" -f $Port)
} catch {}

while ($true) {
  $client = $null
  $stream = $null
  try {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $stream.ReadTimeout = 5000

    $buffer = New-Object byte[] 8192
    $read = $stream.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) { continue }

    $requestText = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $read)
    $firstLine = ($requestText -split "`r`n")[0]
    if ($firstLine -notmatch "^(GET|HEAD)\s+(\S+)\s+HTTP") {
      $body = [System.Text.Encoding]::UTF8.GetBytes("405 Method Not Allowed")
      Send-HttpResponse $stream 405 "Method Not Allowed" "text/plain; charset=utf-8" $body
      continue
    }

    $rawPath = $Matches[2]
    $path = [Uri]::UnescapeDataString(($rawPath -split "\?")[0])
    if ([string]::IsNullOrWhiteSpace($path) -or $path -eq "/") {
      $path = "/index.html"
    }

    $relative = $path.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
    $fullPath = [IO.Path]::GetFullPath((Join-Path $root $relative))

    if (-not $fullPath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
      $body = [System.Text.Encoding]::UTF8.GetBytes("403")
      Send-HttpResponse $stream 403 "Forbidden" "text/plain; charset=utf-8" $body
    } elseif (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
      $body = [System.Text.Encoding]::UTF8.GetBytes("404 No encontrado: $path")
      Send-HttpResponse $stream 404 "Not Found" "text/plain; charset=utf-8" $body
    } else {
      $bytes = [IO.File]::ReadAllBytes($fullPath)
      $ext = [IO.Path]::GetExtension($fullPath)
      Send-HttpResponse $stream 200 "OK" (Get-ContentType $ext) $bytes
      $remote = $client.Client.RemoteEndPoint
      Write-Host ("[{0}] {1} <- {2}" -f (Get-Date -Format "HH:mm:ss"), $path, $remote)
    }
  } catch {
    # Ignorar clientes que cierran la conexion
  } finally {
    if ($stream) { try { $stream.Close() } catch {} }
    if ($client) { try { $client.Close() } catch {} }
  }
}
