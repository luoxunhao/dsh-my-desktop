<#
.SYNOPSIS
  Build DSH My Desktop installers using the project-local pinned Node runtime.

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
  # 自动定位 pnpm：优先当前用户的 npm 全局安装目录，再回退到 PATH 上的 pnpm。
  # （不要写死某个用户路径，例如 C:\Users\<用户>\AppData\Roaming\npm\pnpm.cmd。）
  $pnpm = $null
  $userNpmDir = Join-Path $env:APPDATA 'npm'
  $candidates = @(
    (Join-Path $userNpmDir 'pnpm.cmd'),
    (Join-Path $userNpmDir 'pnpm')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { $pnpm = $candidate; break }
  }
  if ($null -eq $pnpm) {
    $onPath = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($onPath) { $pnpm = $onPath.Source }
  }
  if ($null -eq $pnpm) {
    throw '未找到 pnpm。请先用 npm 全局安装 pnpm（npm install -g pnpm@<项目要求版本>）或确保 pnpm 在 PATH 上。'
  }
  Write-Host "Using pnpm: $pnpm"
  Write-Host "==> pnpm run $Target"
  cmd /c "`"$pnpm`" run $Target 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "pnpm run $Target failed (exit code $LASTEXITCODE)." }
} finally {
  Pop-Location
}
Write-Host "Done: pnpm run $Target"
