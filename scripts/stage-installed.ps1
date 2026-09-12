# Stage freshly built artifacts into the installed app and the per-user
# materialized copies. Run elevated: the install dir lives under Program Files.
$ErrorActionPreference = 'Stop'

$src = 'E:\project\dsh\dsh-my-desktop\release\win-unpacked\resources'
$app = 'D:\Program Files\DSH My Desktop\resources'
$userData = Join-Path $env:APPDATA 'DSH My Desktop'

function Copy-Tree($from, $to) {
  if (-not (Test-Path $from)) { throw "missing source: $from" }
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  Copy-Item -Path (Join-Path $from '*') -Destination $to -Recurse -Force
}

# 1) installed app resources
Copy-Item (Join-Path $src 'app.asar') (Join-Path $app 'app.asar') -Force
Copy-Tree (Join-Path $src 'desktop-bridge') (Join-Path $app 'desktop-bridge')

# 1b) The shell window documents and the recovery page are NOT read from app.asar:
#     `resolveShellAsset` and `resolveRecoveryUiHtml` check
#     `process.resourcesPath/<dir>/` FIRST and only fall back to the app bundle.
#     Staging just the asar therefore leaves the title bar and the recovery page
#     running old HTML — a fix that "looks applied" but is not. Both are build
#     outputs of `build:all` (shell-ui) and `build:recovery-ui`, so copy the whole
#     directory rather than a hand-listed file.
Copy-Tree (Join-Path $src 'shell-ui') (Join-Path $app 'shell-ui')
Copy-Tree (Join-Path $src 'recovery-ui') (Join-Path $app 'recovery-ui')

# 2) per-user materialized copies (the running app loads these, not the repo).
#    Only overwrite lib/ + cordis.patch.yml: the materialized dir keeps its own
#    package.json / settings.patch.yml, which the built resource tree lacks.
$builtPlugin = Join-Path $src 'dsh-my-desktop-setting'
$userPlugin = Join-Path $userData 'desktop-settings-plugin'
Copy-Tree (Join-Path $builtPlugin 'lib') (Join-Path $userPlugin 'lib')
Copy-Item (Join-Path $builtPlugin 'cordis.patch.yml') (Join-Path $userPlugin 'cordis.patch.yml') -Force

# 3) same for the installed app's plugin copy
Copy-Tree (Join-Path $builtPlugin 'lib') (Join-Path $app 'dsh-my-desktop-setting\lib')
Copy-Item (Join-Path $builtPlugin 'cordis.patch.yml') (Join-Path $app 'dsh-my-desktop-setting\cordis.patch.yml') -Force

# 4) the bridge also lives materialized under userData
Copy-Tree (Join-Path $src 'desktop-bridge') (Join-Path $userData 'desktop-bridge')

Write-Output 'staged ok'
Write-Output ("app.asar        {0}" -f (Get-Item (Join-Path $app 'app.asar')).LastWriteTime)
Write-Output ("shell.html      {0}" -f (Get-Item (Join-Path $app 'shell-ui\shell.html')).LastWriteTime)
Write-Output ("recovery index  {0}" -f (Get-Item (Join-Path $app 'recovery-ui\index.html')).LastWriteTime)
Write-Output ("bridge host.js  {0}" -f (Get-Item (Join-Path $app 'desktop-bridge\desktop-host.js')).LastWriteTime)
Write-Output ("userData host   {0}" -f (Get-Item (Join-Path $userData 'desktop-bridge\desktop-host.js')).LastWriteTime)
Write-Output ("userData index  {0}" -f (Get-Item (Join-Path $userPlugin 'lib\index.js')).LastWriteTime)
Write-Output ("userData client {0}" -f (Get-Item (Join-Path $userPlugin 'lib\client.js')).LastWriteTime)
