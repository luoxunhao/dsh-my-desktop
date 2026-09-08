<#
.SYNOPSIS
  Build DSH Desktop installers using the project-local pinned Node runtime.

.DESCRIPTION
  prepare-runtime requires the exact official Node v24.20.0 (it validates the
  running node's version + SHA256). This helper prepends the gitignored,
  project-local `.build-node` (the extracted official v24.20.0 win-x64) to
  PATH and runs the requested build script, so you never re-download Node.

.PARAMETER Target
  The pnpm script to run. Defaults to "dist" (full NSIS installer).
  Useful values: "pack" (win-unpacked dir), "prepare-runtime", "test".

.EXAMPLE
  .\scripts\build.ps1                 # pnpm run dist (full NSIS installer)
  .\scripts\build.ps1 -Target pack    # electron-builder --dir
#>
[CmdletBinding()]
param(
  [string]$Target = 'dist'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodeDir = Join-Path $root '.build-node'
$nodeExe = Join-Path $nodeDir 'node.exe'

if (-not (Test-Path $nodeExe)) {
  throw "Missing local Node $nodeExe . Download official Node v24.20.0 win-x64 and extract to .build-node/ (https://nodejs.org/dist/v24.20.0/node-v24.20.0-win-x64.zip)."
}

$actual = & $nodeExe --version
if ($actual -ne 'v24.20.0') {
  throw "Bundled Node must be v24.20.0; got $actual ."
}

Write-Host "Using Node: $actual  ($nodeDir)"
Push-Location $root
try {
  # Put the project-local Node first on PATH so pnpm / electron-builder /
  # prepare-runtime all run under it.
  $env:Path = "$nodeDir;$env:Path"
  $pnpm = 'C:\Users\admin\AppData\Roaming\npm\pnpm.cmd'
  if (-not (Test-Path $pnpm)) {
    $pnpm = 'pnpm'   # fall back to whatever pnpm is on PATH
  }
  Write-Host "==> pnpm run $Target"
  cmd /c "`"$pnpm`" run $Target 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "pnpm run $Target failed (exit code $LASTEXITCODE)." }
} finally {
  Pop-Location
}
Write-Host "Done: pnpm run $Target"
