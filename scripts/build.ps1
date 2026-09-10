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

# 目标别名：把友好的连字符名映射到 package.json 脚本名。
# 免重装配（本地缓存优先、零联网）出包走 dist-local / pack-local —— 前提是
# 官方运行时(runtime-dsh.tgz / runtime-dsh)已在本仓库装配过一次。
$targetAliases = @{
  'dist-local'       = 'dist:local'
  'pack-local'       = 'pack:local'
  'dist'             = 'dist'
  'pack'             = 'pack'
  'prepare-runtime'  = 'prepare-runtime'
  'build'            = 'build'
  'test'             = 'test'
}
if ($targetAliases.ContainsKey($Target)) { $Target = $targetAliases[$Target] }

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
  # 缓存优先、避免直连 GitHub 拉不动的产物（electron 运行时 / winCodeSign /
  # nsis 等 electron-builder 工具）。默认走可访问的镜像源；已设过则保留用户值。
  # 命中本地 electron-builder 缓存后不会再联网；只在缓存缺失时才去镜像拉一次。
  if (-not $env:ELECTRON_MIRROR) { $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/' }
  if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) { $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/' }
  Write-Host "electron mirror: $env:ELECTRON_MIRROR"
  Write-Host "electron-builder binaries mirror: $env:ELECTRON_BUILDER_BINARIES_MIRROR"
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
