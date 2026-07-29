param(
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot ".wordloop-runtime"
$websiteUrl = "http://localhost:3000"
$titleMarker = "词环 WordLoop"

function Show-LaunchError {
  param([string]$Message)

  try {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      $Message,
      "词环启动失败",
      [System.Windows.MessageBoxButton]::OK,
      [System.Windows.MessageBoxImage]::Error
    ) | Out-Null
  } catch {
    Write-Host $Message -ForegroundColor Red
  }
}

function Test-WordLoop {
  try {
    $response = Invoke-WebRequest `
      -Uri $websiteUrl `
      -UseBasicParsing `
      -TimeoutSec 3
    return $response.StatusCode -eq 200 `
      -and $response.Content.Contains($titleMarker)
  } catch {
    return $false
  }
}

$serverProcess = $null
$startedListenerPid = $null

function Test-ProcessDescendant {
  param(
    [int]$CandidatePid,
    [int]$RootPid
  )

  $currentPid = $CandidatePid
  for ($depth = 0; $depth -lt 10 -and $currentPid; $depth += 1) {
    if ($currentPid -eq $RootPid) {
      return $true
    }
    $process = Get-CimInstance `
      Win32_Process `
      -Filter "ProcessId = $currentPid" `
      -ErrorAction SilentlyContinue
    if (-not $process) {
      return $false
    }
    $currentPid = [int]$process.ParentProcessId
  }
  return $false
}

try {
  $listener = Get-NetTCPConnection `
    -LocalPort 3000 `
    -State Listen `
    -ErrorAction SilentlyContinue |
    Select-Object -First 1

  if ($listener) {
    if (-not (Test-WordLoop)) {
      throw "固定端口 3000 已被其他程序占用（PID $($listener.OwningProcess)），未启动词环。"
    }
  } else {
    $npm = Get-Command npm.cmd -ErrorAction Stop
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"

    if (-not (Test-Path (Join-Path $projectRoot "dist\server\index.js"))) {
      $buildLog = Join-Path $runtimeRoot "build-$stamp.log"
      $buildErrorLog = Join-Path $runtimeRoot "build-$stamp.error.log"
      $buildProcess = Start-Process `
        -FilePath $npm.Source `
        -ArgumentList @("run", "build") `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $buildLog `
        -RedirectStandardError $buildErrorLog `
        -PassThru `
        -Wait
      if ($buildProcess.ExitCode -ne 0) {
        throw "网站构建失败，请查看 $buildErrorLog"
      }
    }

    $serverLog = Join-Path $runtimeRoot "server-$stamp.log"
    $serverErrorLog = Join-Path $runtimeRoot "server-$stamp.error.log"
    $serverProcess = Start-Process `
      -FilePath $npm.Source `
      -ArgumentList @("run", "start", "--", "--port", "3000") `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $serverLog `
      -RedirectStandardError $serverErrorLog `
      -PassThru
    Set-Content `
      -LiteralPath (Join-Path $runtimeRoot "launcher.pid") `
      -Value $serverProcess.Id `
      -Encoding ascii

    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
      Start-Sleep -Milliseconds 500
      if ($serverProcess.HasExited) {
        throw "网站服务启动失败，请查看 $serverErrorLog"
      }
      $startedListener = Get-NetTCPConnection `
        -LocalPort 3000 `
        -State Listen `
        -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if (
        $startedListener `
        -and -not (Test-ProcessDescendant `
          -CandidatePid $startedListener.OwningProcess `
          -RootPid $serverProcess.Id)
      ) {
        throw "固定端口 3000 在启动期间被其他程序占用。"
      }
      if ($startedListener -and (Test-WordLoop)) {
        $startedListenerPid = $startedListener.OwningProcess
        $ready = $true
        break
      }
    }
    if (-not $ready) {
      Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue
      throw "网站服务在 20 秒内没有就绪，请查看 $serverErrorLog"
    }

    if ($startedListenerPid) {
      Set-Content `
        -LiteralPath (Join-Path $runtimeRoot "server.pid") `
        -Value $startedListenerPid `
        -Encoding ascii
    }
  }

  if (-not $NoOpen) {
    Start-Process $websiteUrl
  }
} catch {
  if ($startedListenerPid) {
    Stop-Process -Id $startedListenerPid -Force -ErrorAction SilentlyContinue
  }
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Show-LaunchError $_.Exception.Message
  exit 1
}
