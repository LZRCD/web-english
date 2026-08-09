param(
  [ValidateSet("Start", "PreCommit", "Finish")]
  [string]$Phase = "Start",
  [string]$ExpectedHead,
  [string]$ExpectedBranch,
  [string[]]$AllowedPath = @(),
  [switch]$Detailed,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

function Invoke-GitResult {
  param([string[]]$Arguments)

  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = & git -c core.quotepath=false @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  return [pscustomobject]@{
    ExitCode = $exitCode
    Output = @($output | ForEach-Object { "$_" })
  }
}

function Invoke-Git {
  param([string[]]$Arguments)

  $result = Invoke-GitResult $Arguments
  if ($result.ExitCode -ne 0) {
    throw "git $($Arguments -join ' ') failed: $($result.Output -join [Environment]::NewLine)"
  }
  return $result.Output
}

function Normalize-Path {
  param([string]$Path)

  return $Path.Trim().Trim('"').Replace("\", "/")
}

function Test-PathMatch {
  param(
    [string]$Path,
    [string[]]$Patterns
  )

  $normalizedPath = Normalize-Path $Path
  foreach ($pattern in $Patterns) {
    $normalizedPattern = Normalize-Path $pattern
    if ($normalizedPath -like $normalizedPattern) {
      return $true
    }
  }
  return $false
}

function Get-StatusEntry {
  param([string]$Line)

  if ($Line.Length -lt 4) {
    return $null
  }
  $path = $Line.Substring(3)
  if ($path.Contains(" -> ")) {
    $path = $path.Substring($path.IndexOf(" -> ") + 4)
  }
  return [pscustomobject]@{
    Code = $Line.Substring(0, 2)
    Path = Normalize-Path $path
  }
}

$protectedPatterns = @(
  "1.txt",
  ".zcode/*",
  ".codex-round*.log",
  "docs/architecture-analysis-*.md",
  "docs/iterations/Typora_Hook_Log.txt"
)
$generatedPatterns = @("lib/build-info.generated.ts")
$normalizedAllowedPaths = @($AllowedPath | ForEach-Object { Normalize-Path $_ })
$blockers = [System.Collections.Generic.List[string]]::new()
$notes = [System.Collections.Generic.List[string]]::new()

Push-Location $projectRoot
try {
  $branch = (Invoke-Git @("branch", "--show-current") | Select-Object -First 1).Trim()
  $head = (Invoke-Git @("rev-parse", "HEAD") | Select-Object -First 1).Trim()
  $statusEntries = @(
    Invoke-Git @("status", "--porcelain=v1", "--untracked-files=all") |
      ForEach-Object { Get-StatusEntry $_ } |
      Where-Object { $null -ne $_ }
  )
  $stagedPaths = @(
    Invoke-Git @("diff", "--cached", "--name-only", "--diff-filter=ACMRD") |
      Where-Object { $_ } |
      ForEach-Object { Normalize-Path $_ }
  )
  $trackedChanges = @($statusEntries | Where-Object { $_.Code -ne "??" })
  $untrackedChanges = @($statusEntries | Where-Object { $_.Code -eq "??" })
  $protectedUntracked = @(
    $untrackedChanges |
      Where-Object { Test-PathMatch $_.Path $protectedPatterns } |
      ForEach-Object { $_.Path }
  )
  $unexpectedUntracked = @(
    $untrackedChanges |
      Where-Object { -not (Test-PathMatch $_.Path $protectedPatterns) }
  )

  if ($ExpectedBranch -and $branch -ne $ExpectedBranch) {
    $blockers.Add("Current branch '$branch' does not match '$ExpectedBranch'.")
  }
  if ($ExpectedHead -and -not $head.StartsWith($ExpectedHead, [System.StringComparison]::OrdinalIgnoreCase)) {
    $blockers.Add("Current HEAD '$head' does not match '$ExpectedHead'.")
  }

  if ($Phase -eq "Start") {
    if ($trackedChanges.Count -gt 0) {
      $blockers.Add("Start gate found tracked changes: $((@($trackedChanges.Path) -join ', '))")
    }
    if ($unexpectedUntracked.Count -gt 0) {
      $blockers.Add("Start gate found unexpected untracked files: $((@($unexpectedUntracked.Path) -join ', '))")
    }
    if ($stagedPaths.Count -gt 0) {
      $blockers.Add("Start gate found staged files: $($stagedPaths -join ', ')")
    }
  }

  if ($Phase -eq "PreCommit") {
    if ($normalizedAllowedPaths.Count -eq 0) {
      $blockers.Add("PreCommit requires an explicit -AllowedPath list.")
    }
    if ($stagedPaths.Count -eq 0) {
      $blockers.Add("PreCommit found an empty index.")
    }
    foreach ($path in $stagedPaths) {
      if (Test-PathMatch $path $protectedPatterns) {
        $blockers.Add("Protected path is staged: $path")
      }
      if (-not (Test-PathMatch $path $normalizedAllowedPaths)) {
        $blockers.Add("Staged path is outside AllowedPath: $path")
      }
    }
    foreach ($entry in $statusEntries) {
      if ($entry.Code -eq "??" -and (Test-PathMatch $entry.Path $protectedPatterns)) {
        continue
      }
      if (-not (Test-PathMatch $entry.Path $normalizedAllowedPaths)) {
        $blockers.Add("Working-tree path is outside AllowedPath: $($entry.Path)")
      }
    }
  }

  if ($Phase -eq "Finish") {
    if ($trackedChanges.Count -gt 0 -or $stagedPaths.Count -gt 0) {
      $blockers.Add("Finish gate found tracked or staged changes.")
    }
    if ($unexpectedUntracked.Count -gt 0) {
      $blockers.Add("Finish gate found unexpected untracked files: $((@($unexpectedUntracked.Path) -join ', '))")
    }
  }

  foreach ($entry in $statusEntries) {
    if (Test-PathMatch $entry.Path $generatedPatterns) {
      $blockers.Add("Generated file drift detected: $($entry.Path)")
    }
  }

  $diffCheck = Invoke-GitResult @("diff", "--check")
  if ($diffCheck.ExitCode -ne 0) {
    $blockers.Add("git diff --check failed: $($diffCheck.Output -join '; ')")
  }
  $cachedDiffCheck = Invoke-GitResult @("diff", "--cached", "--check")
  if ($cachedDiffCheck.ExitCode -ne 0) {
    $blockers.Add("git diff --cached --check failed: $($cachedDiffCheck.Output -join '; ')")
  }

  if ($protectedUntracked.Count -gt 0) {
    $notes.Add("Protected untracked paths preserved: $($protectedUntracked.Count).")
    if ($Detailed) {
      $notes.Add("Protected paths: $($protectedUntracked -join ', ')")
    }
  }

  $port3000 = @()
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $port3000 = @(
      Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
          $process = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
          [pscustomobject]@{
            Pid = $_.OwningProcess
            ProcessName = $process.ProcessName
          }
        }
    )
  }
  if ($port3000.Count -eq 0) {
    $notes.Add("Fixed port 3000 has no listener.")
  } else {
    $listeners = @($port3000 | ForEach-Object { "PID $($_.Pid) $($_.ProcessName)" })
    $notes.Add("Fixed port 3000: $($listeners -join ', '). Verify project ownership before reuse.")
  }

  $result = [ordered]@{
    Phase = $Phase
    Ok = $blockers.Count -eq 0
    Branch = $branch
    Head = $head
    ChangedPaths = @($statusEntries.Path)
    StagedPaths = $stagedPaths
    ProtectedUntracked = $protectedUntracked
    Port3000 = $port3000
    Blockers = @($blockers)
    Notes = @($notes)
  }

  if ($Json) {
    $result | ConvertTo-Json -Depth 5
  } else {
    $state = if ($result.Ok) { "PASS" } else { "BLOCK" }
    Write-Output "[$state] $Phase | $branch | $head"
    foreach ($note in $notes) {
      Write-Output "[INFO] $note"
    }
    foreach ($blocker in $blockers) {
      Write-Output "[BLOCK] $blocker"
    }
  }

  if (-not $result.Ok) {
    exit 2
  }
} finally {
  Pop-Location
}
