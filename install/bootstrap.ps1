﻿<#
  renderdeck bootstrap - Windows.

    irm https://raw.githubusercontent.com/williamjvest/renderdeck/main/install/bootstrap.ps1 | iex
  or, with arguments:
    .\bootstrap.ps1 -Collector http://HOST:8090 -Token TOKEN

  Idempotent: re-run to upgrade. Installs to $HOME\renderdeck, writes the
  config, and registers a scheduled task per program so the watchers come back
  after a reboot.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Collector,
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Machine = "",
  [string]$Dest = "$HOME\renderdeck",
  [string]$Repo = "https://github.com/williamjvest/renderdeck"
)

$ErrorActionPreference = "Stop"

function Find-Python {
  # Probe by IMPORTING, not by presence. A python on PATH that can't do ssl or
  # sqlite3 is no use to us, and Windows ships an App Execution Alias stub that
  # resolves and then opens the Store.
  foreach ($c in @("$env:PROGRAMFILES\Python312\python.exe",
                   "$env:PROGRAMFILES\Python311\python.exe",
                   "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
                   "python.exe", "python3.exe")) {
    try {
      $p = (Get-Command $c -EA SilentlyContinue).Source
      if (-not $p) { if (Test-Path $c) { $p = $c } else { continue } }
      & $p -c "import ssl,sqlite3" 2>$null
      if ($LASTEXITCODE -eq 0) { return $p }
    } catch { }
  }
  return $null
}

$py = Find-Python
if (-not $py) {
  Write-Host "==> no usable python - installing a private one (no admin)"
  $tag = "20260807"; $ver = "3.12.13"
  $plat = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "aarch64-pc-windows-msvc" } else { "x86_64-pc-windows-msvc-shared" }
  $tarball = "cpython-$ver+$tag-$plat-install_only_stripped.tar.gz"
  $base = "https://github.com/astral-sh/python-build-standalone/releases/download/$tag"
  $stage = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  Invoke-WebRequest "$base/$tarball" -OutFile "$stage\py.tgz" -UseBasicParsing

  # Verify before extracting: a curl|iex installer that runs unverified code is
  # a supply-chain hole.
  try {
    Invoke-WebRequest "$base/SHA256SUMS" -OutFile "$stage\sums" -UseBasicParsing
    $want = (Select-String -Path "$stage\sums" -Pattern ([regex]::Escape($tarball)) |
             Select-Object -First 1).Line.Split(" ")[0]
    $got = (Get-FileHash "$stage\py.tgz" -Algorithm SHA256).Hash.ToLower()
    if ($want -and $want.ToLower() -ne $got) {
      Remove-Item $stage -Recurse -Force
      Write-Host "checksum MISMATCH for $tarball"
      Write-Host "  expected $want"
      Write-Host "  got      $got"
      throw "python tarball failed checksum verification"
    }
    Write-Host "    checksum verified"
  } catch [System.Net.WebException] {
    Write-Warning "could not fetch SHA256SUMS - python NOT verified"
  }

  $pyroot = "$env:LOCALAPPDATA\renderdeck\python"
  New-Item -ItemType Directory -Path "$stage\x" -Force | Out-Null
  tar -xzf "$stage\py.tgz" -C "$stage\x" --strip-components=1
  if (Test-Path $pyroot) { Remove-Item $pyroot -Recurse -Force }
  New-Item -ItemType Directory -Path (Split-Path $pyroot) -Force | Out-Null
  Move-Item "$stage\x" $pyroot
  Remove-Item $stage -Recurse -Force
  $py = "$pyroot\python.exe"
}
$pyver = (& $py -V) 2>&1
Write-Host "==> python: $pyver  ($py)"

Write-Host "==> fetching renderdeck into $Dest"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
Invoke-WebRequest "$Repo/archive/refs/heads/main.tar.gz" -OutFile "$tmp\rd.tgz" -UseBasicParsing
tar -xzf "$tmp\rd.tgz" -C $tmp
if (-not (Test-Path "$tmp\renderdeck-main\install\setup.py")) {
  Remove-Item $tmp -Recurse -Force; throw "downloaded archive doesn't look like renderdeck"
}
if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
Move-Item "$tmp\renderdeck-main" $Dest
Remove-Item $tmp -Recurse -Force

Write-Host "==> writing config"
$args = @("$Dest\install\setup.py", "--collector", $Collector, "--token", $Token)
if ($Machine) { $args += @("--machine", $Machine) }
& $py @args

# Only register a watcher for a program that is actually installed.
$haveAe      = Test-Path "$env:PROGRAMFILES\Adobe\Adobe After Effects*"
$haveResolve = Test-Path "$env:PROGRAMFILES\Blackmagic Design\DaVinci Resolve"
Write-Host "==> detecting installed programs"
if ($haveAe)      { Write-Host "    After Effects: yes" }
else              { Write-Host "    After Effects: not installed - skipping" }
if ($haveResolve) { Write-Host "    DaVinci Resolve: yes" }
else              { Write-Host "    DaVinci Resolve: not installed - skipping" }
if (-not $haveAe -and -not $haveResolve) { throw "no supported program found" }

function Register-Watcher($name, $script, $extra) {
  # schtasks mangles /tr when the command contains quotes and spaces
  # ("Invalid argument/option - Files\Python312\python.exe"), so the task
  # launches ONE argument-free .cmd and the shim owns the quoting.
  $cmd = Join-Path $Dest ("run-" + $name + ".cmd")
  $exe = Join-Path $Dest ("watchers\" + $script)
  $shim = @("@echo off", ('"' + $py + '" "' + $exe + '" ' + $extra))
  Set-Content -Path $cmd -Value $shim -Encoding ASCII
  schtasks /create /f /sc ONLOGON /ru $env:USERNAME /tn "Renderdeck$name" /tr $cmd | Out-Null
  schtasks /run /tn "Renderdeck$name" | Out-Null
  Write-Host "    scheduled task: Renderdeck$name"
}

Write-Host "==> installing services (survive reboot)"
if ($haveAe)      { Register-Watcher "AE"      "renderdeck-ae-sequence" "--interval 30" }
if ($haveResolve) { Register-Watcher "Resolve" "renderdeck-resolve"     "" }

Start-Sleep -Seconds 6
Write-Host "==> verifying"
$verify = Join-Path ([IO.Path]::GetTempPath()) "renderdeck-verify.py"
$vlines = @(
  'import json, sys, urllib.request',
  'sys.path.insert(0, sys.argv[1])',
  'from renderdeck.config import load',
  'c = load()',
  'print("    machine   :", c["machine"])',
  'print("    collector :", c["collector"])',
  'try:',
  '    u = c["collector"].rstrip("/") + "/api/state"',
  '    d = json.load(urllib.request.urlopen(u, timeout=8))',
  '    mine = [m for m in d["machines"] if m["machine"] == c["machine"]]',
  '    if mine:',
  '        for m in mine:',
  '            print("    reporting :", m["app"], "(age " + str(m["age_s"]) + "s)")',
  '    else:',
  '        print("    reporting : NOT YET VISIBLE - check the dashboard in 30s")',
  'except Exception as e:',
  '    print("    collector unreachable:", e)'
)
Set-Content -Path $verify -Value $vlines -Encoding UTF8
& $py $verify $Dest
Remove-Item $verify -Force -EA SilentlyContinue
Write-Host "==> done"
