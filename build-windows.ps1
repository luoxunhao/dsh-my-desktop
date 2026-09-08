# DSH My Desktop — Windows x64 打包脚本
#
# 在项目根目录以 PowerShell 运行本脚本，产出 NSIS 安装器 (.exe) 与 .zip 到 release\。
#
# 前置条件（务必精确匹配 package.json engines 与 config.bundledNodeVersion）：
#   - Windows x64
#   - Node.js  24.20.0  （prepare-runtime 会校验随包 Node 的 SHA256，版本必须完全一致）
#   - pnpm     11.24.0
#   - 首次运行会从 registry.npmjs.org 装配官方 DSH 运行时与随包 pnpm，需要网络。
#
# 用法：  powershell -ExecutionPolicy Bypass -File .\build-windows.ps1
# 产物：  release\dsh-my-desktop-<version>-win-x64.exe  （NSIS 安装器）
#         release\dsh-my-desktop-<version>-win-x64.zip
#         release\win-unpacked\DSH My Desktop.exe           （免安装解包版）

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = $PSScriptRoot
Push-Location $root

try {
    Write-Host '==> 0/4 环境检查' -ForegroundColor Cyan
    $nodeReq = '24.20.0'
    $nodeVer = node --version
    if ($nodeVer.Trim() -ne "v$nodeReq") {
        throw "Node 版本不匹配：需要 v$nodeReq，实际 $nodeVer。请安装并使用 Node $nodeReq（可用 nvm 切换）。"
    }
    Write-Host "    Node: $nodeVer"

    $pnpmReq = '11.24.0'
    $pnpmVer = pnpm --version
    if ($pnpmVer.Trim() -ne $pnpmReq) {
        Write-Warning "pnpm 版本 $pnpmVer 与期望 $pnpmReq 不一致。若失败请用 corepack/pnpm@$pnpmReq 切换。"
    }
    Write-Host "    pnpm: $pnpmVer"

    Write-Host '==> 1/4 安装依赖 (pnpm install --frozen-lockfile)' -ForegroundColor Cyan
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install 失败。' }

    Write-Host '==> 2/4 编译与测试 (pnpm test)' -ForegroundColor Cyan
    pnpm test
    if ($LASTEXITCODE -ne 0) { throw 'pnpm test 失败。' }

    Write-Host '==> 3/4 装配随包运行时 (pnpm run prepare-runtime)' -ForegroundColor Cyan
    # 装配 runtime-node / runtime-plugins / runtime-dsh.tgz 等 extraResources
    pnpm run prepare-runtime
    if ($LASTEXITCODE -ne 0) { throw 'prepare-runtime 失败。' }

    Write-Host '==> 4/4 打包 (electron-builder --win --x64 --publish never)' -ForegroundColor Cyan
    # 未配置 Windows 代码签名证书时产出未签名测试版，可正常安装使用。
    pnpm exec electron-builder --win --x64 --publish never
    if ($LASTEXITCODE -ne 0) { throw 'electron-builder 打包失败。' }

    Write-Host ''
    Write-Host '打包完成。产物位于：' -ForegroundColor Green
    Get-ChildItem -LiteralPath (Join-Path $root 'release') -File |
        Where-Object { $_.Extension -in '.exe', '.zip' } |
        ForEach-Object { Write-Host "    $($_.FullName)" -ForegroundColor Green }
}
finally {
    Pop-Location
}
