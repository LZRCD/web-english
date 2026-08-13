param(
  [ValidateSet("Start", "Status", "Stop", "Worker")]
  [string]$Action = "Status",
  [int]$TimeoutSeconds = 30,
  [string]$OutLog,
  [string]$ErrorLog
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot ".wordloop-runtime\rounds"
$statePath = Join-Path $runtimeRoot "dev-server.json"
$websiteUrl = "http://127.0.0.1:3000"

function Get-PortListener {
  try {
    return Get-NetTCPConnection `
      -State Listen `
      -ErrorAction Stop |
      Where-Object { $_.LocalPort -eq 3000 } |
      Select-Object -First 1
  } catch {
    throw "Unable to inspect port 3000; refusing to assume it is free: $($_.Exception.Message)"
  }
}

function Test-Health {
  try {
    $response = Invoke-WebRequest `
      -Uri $websiteUrl `
      -UseBasicParsing `
      -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-ProcessDescendant {
  param(
    [int]$CandidatePid,
    [int]$RootPid
  )

  $currentPid = $CandidatePid
  for ($depth = 0; $depth -lt 16 -and $currentPid; $depth += 1) {
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

function Get-ManagedState {
  if (-not (Test-Path -LiteralPath $statePath)) {
    return $null
  }
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if ($state.ProjectRoot -ne $projectRoot) {
    throw "Managed state belongs to another project: $($state.ProjectRoot)"
  }
  return $state
}

function Stop-ManagedTree {
  param([int]$RootPid)

  $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $depthByPid = @{}
  $depthByPid[$RootPid] = 0
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $all) {
      $parentPid = [int]$process.ParentProcessId
      $processPid = [int]$process.ProcessId
      if ($depthByPid.ContainsKey($parentPid) -and -not $depthByPid.ContainsKey($processPid)) {
        $depthByPid[$processPid] = $depthByPid[$parentPid] + 1
        $changed = $true
      }
    }
  }
  $depthByPid.GetEnumerator() |
    Sort-Object Value -Descending |
    ForEach-Object {
      Stop-Process -Id ([int]$_.Key) -Force -ErrorAction SilentlyContinue
    }
}

if ($Action -eq "Worker") {
  if (-not $OutLog -or -not $ErrorLog) {
    throw "Worker requires -OutLog and -ErrorLog."
  }
  Set-Location $projectRoot
  $npm = Get-Command npm.cmd -ErrorAction Stop
  $devProcess = Start-Process `
    -FilePath $npm.Source `
    -ArgumentList @("run", "dev") `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrorLog `
    -PassThru `
    -Wait
  exit $devProcess.ExitCode
}

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

if ($Action -eq "Status") {
  $state = Get-ManagedState
  $listener = Get-PortListener
  if (-not $listener) {
    Write-Output "STOPPED | port 3000 is free"
    exit 0
  }
  if (
    $state `
    -and (Test-ProcessDescendant `
      -CandidatePid $listener.OwningProcess `
      -RootPid $state.WorkerPid)
  ) {
    $health = if (Test-Health) { "healthy" } else { "unhealthy" }
    Write-Output "RUNNING | $health | worker PID $($state.WorkerPid) | listener PID $($listener.OwningProcess)"
    Write-Output "LOG | $($state.OutLog)"
    exit 0
  }
  Write-Output "UNMANAGED | port 3000 | listener PID $($listener.OwningProcess)"
  exit 2
}

if ($Action -eq "Stop") {
  $state = Get-ManagedState
  $listener = Get-PortListener
  if (-not $state) {
    if ($listener) {
      throw "Port 3000 is active but not managed by this script; refusing to stop it."
    }
    Write-Output "STOPPED | no managed server"
    exit 0
  }
  if (
    $listener `
    -and -not (Test-ProcessDescendant `
      -CandidatePid $listener.OwningProcess `
      -RootPid $state.WorkerPid)
  ) {
    throw "Port 3000 is owned by another process; refusing to stop it."
  }
  Stop-ManagedTree -RootPid $state.WorkerPid
  Start-Sleep -Milliseconds 500
  if (Get-PortListener) {
    throw "Managed process tree stopped, but port 3000 is still active."
  }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  Write-Output "STOPPED | worker PID $($state.WorkerPid)"
  exit 0
}

$existingState = Get-ManagedState
$listener = Get-PortListener
if ($listener) {
  if (
    $existingState `
    -and (Test-ProcessDescendant `
      -CandidatePid $listener.OwningProcess `
      -RootPid $existingState.WorkerPid) `
    -and (Test-Health)
  ) {
    Write-Output "REUSED | worker PID $($existingState.WorkerPid) | listener PID $($listener.OwningProcess)"
    exit 0
  }
  throw "Port 3000 is already occupied by an unmanaged or unhealthy process (PID $($listener.OwningProcess))."
}

if ($existingState) {
  $worker = Get-Process -Id $existingState.WorkerPid -ErrorAction SilentlyContinue
  if ($worker) {
    Stop-ManagedTree -RootPid $existingState.WorkerPid
  }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$OutLog = Join-Path $runtimeRoot "dev-$stamp.out.log"
$ErrorLog = Join-Path $runtimeRoot "dev-$stamp.err.log"
$hostExecutable = (Get-Process -Id $PID).Path
$commandLine = ('"{0}" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{1}" -Action Worker -OutLog "{2}" -ErrorLog "{3}"' -f `
  $hostExecutable,
  $PSCommandPath,
  $OutLog,
  $ErrorLog)
$created = Invoke-CimMethod `
  -ClassName Win32_Process `
  -MethodName Create `
  -Arguments @{
    CommandLine = $commandLine
    CurrentDirectory = $projectRoot
  }
if ($created.ReturnValue -ne 0) {
  throw "Win32_Process.Create failed with code $($created.ReturnValue)."
}

$workerPid = [int]$created.ProcessId
$ready = $false
$listenerPid = $null
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
try {
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $worker = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
    if (-not $worker) {
      throw "Dev server worker exited before health check; see $ErrorLog"
    }
    $listener = Get-PortListener
    if ($listener) {
      if (-not (Test-ProcessDescendant -CandidatePid $listener.OwningProcess -RootPid $workerPid)) {
        throw "Port 3000 was claimed by another process during startup."
      }
      if (Test-Health) {
        $listenerPid = [int]$listener.OwningProcess
        $ready = $true
        break
      }
    }
  }
  if (-not $ready) {
    throw "Dev server did not become healthy within $TimeoutSeconds seconds; see $ErrorLog"
  }
  [ordered]@{
    ProjectRoot = $projectRoot
    WorkerPid = $workerPid
    ListenerPid = $listenerPid
    StartedAt = (Get-Date).ToString("o")
    OutLog = $OutLog
    ErrorLog = $ErrorLog
  } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
  Write-Output "STARTED | worker PID $workerPid | listener PID $listenerPid"
  Write-Output "LOG | $OutLog"
} catch {
  Stop-ManagedTree -RootPid $workerPid
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  throw
}
