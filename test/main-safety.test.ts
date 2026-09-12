import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('主进程安装全局异常兜底并复用统一退出清理', async () => {
  const source = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  assert.match(source, /process\.on\('uncaughtException'/)
  assert.match(source, /process\.on\('unhandledRejection'/)
  assert.match(source, /async function shutdownDesktop/)
  assert.equal((source.match(/quitDesktopApp\(/g) ?? []).length, 1)
})

test('缺少离线 store 时仍执行官方清理和补种入口', async () => {
  const source = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /if \(pluginStoreDir !== undefined\) \{\s*try \{\s*const seeded = await seedBundledPlugins/)
})

test('主窗口导航完成前不结束启动或插件热重载', async () => {
  const source = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  // Window creation (including the navigation guards) now lives in the registry.
  const registry = await readFile(new URL('../../src/desktop/window-registry.ts', import.meta.url), 'utf8')
  // 恢复页使用专用导航：DSH 页面确认可用后才切换内容视图。
  assert.equal((source.match(/await openWorkbenchOrRecovery\(/g) ?? []).length, 2)
  assert.match(source, /isRecycling = true\s+broadcastShellState\(\)\s+try \{\s+await showStartupWindow\(desktopText\('加载中', 'Loading'\)\)/)
  assert.match(source, /console\.error\('显示启动错误页面失败。'/)
  assert.match(registry, /will-navigate'[\s\S]*?deps\.isNavigating\(\)[\s\S]*?event\.preventDefault\(\)/)
  assert.match(source, /watchProfileActivation\(profileDir, scheduleProfileActivationRecycle/)
  assert.match(source, /waitForDshMarketBatchToSettle\(/)
  assert.match(source, /function handleDshIpc\(message: unknown\): void \{[\s\S]*?scheduleProfileActivationRecycle\(\)/)
  assert.match(source, /profileActivationRecycleGeneration !== generation\) continue/)
  assert.match(source, /escapeRoute\(/)
  assert.doesNotMatch(source, /contents === state\.windows\.dshView\?\.webContents \|\| contents === state\.windows\.mainWindow\?\.webContents/)
  assert.match(source, /state\.shell\.settingsDialogVisible/)
  const routes = await readFile(new URL('../../src/desktop/ipc-routes.ts', import.meta.url), 'utf8')
  assert.match(routes, /\[role=\"dialog\"\]\[aria-modal=\"true\"\]/)
  assert.match(routes, /\^\(设置\|settings\)\$/)
  assert.match(source, /dismissDshSettingsDialog\(\)/)
})

test('桌面壳与 DSH 内容分层并复用托盘重载实现', async () => {
  const source = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  // Layering (shell window + child content views) is created by the window registry.
  const registry = await readFile(new URL('../../src/desktop/window-registry.ts', import.meta.url), 'utf8')
  // The tray's reload item now delegates through an injected callback.
  const trayService = await readFile(new URL('../../src/desktop/tray-service.ts', import.meta.url), 'utf8')
  assert.match(registry, /new WebContentsView/)
  assert.match(registry, /window\.contentView\.addChildView\(view\)/)
  assert.match(trayService, /deps\.reloadDsh\(\)/)
  assert.match(trayService, /if \(id === 'reload'\) \{\s+await deps\.reloadDsh\(\)/)
  assert.match(registry, /title: DESKTOP_APP_NAME/)
})

test('插件恢复页使用独立内容视图和受限 preload，不复用 DSH 侧栏', async () => {
  const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  // The recovery view is declared on the state store (it is shared mutable state),
  // so assert the declaration there rather than in main.ts.
  const stateSource = await readFile(new URL('../../src/desktop/desktop-state.ts', import.meta.url), 'utf8')
  // The recovery view is created by the window registry.
  const registry = await readFile(new URL('../../src/desktop/window-registry.ts', import.meta.url), 'utf8')
  assert.match(stateSource, /recoveryView: WebContentsView \| undefined/)
  assert.match(registry, /preload: deps\.resolvePreload\('recovery-preload\.cjs'\)/)
  assert.match(main, /function showRecoveryWindow/)
  // The recovery window dimensions are now set by the recovery service.
  const recoveryService = await readFile(new URL('../../src/recovery/recovery-service.ts', import.meta.url), 'utf8')
  assert.match(recoveryService, /window\.unmaximize\(\)\s+window\.setSize\(920, 680\)/)
  assert.match(registry, /state\.windows\.dshView\?\.setVisible\(false\)/)
})

test('恢复页是 Vite 构建产物，且不携带外壳的侧栏/标题栏结构', async () => {
  // The page moved from a hand-written `assets/recovery.html` to a built bundle. It
  // must still be a SEPARATE document from the shell: it is loaded into its own
  // WebContentsView with the restricted recovery preload, so it must not pull in the
  // shell's chrome (side bar, title bar, step indicator).
  const app = await readFile(new URL('../../frontend/recovery/App.tsx', import.meta.url), 'utf8')
  const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  assert.match(main, /resolveRecoveryUiHtml\(\)/, '恢复窗口应加载构建产物')
  assert.match(main, /resourcesPath, 'frontend', 'recovery', 'index\.html'/, '打包路径应指向 frontend/recovery')
  assert.doesNotMatch(app, /dshShell/)
  assert.doesNotMatch(app, /class="titlebar"/)
  assert.doesNotMatch(app, /class="steps"/)
})

test('恢复页的「重启」走应用级重启，而不是依赖运行中的 server', async () => {
  // THE BUG THIS PINS: the footer restart button was wired to returnToWorkbench,
  // which refuses when no DSH server is running ("DSH 尚未成功启动") — so clicking
  // 重启 from a recovery session (which by definition has no server) always failed.
  // The reference's restart action relaunches the whole APPLICATION with no such
  // precondition.
  const app = await readFile(new URL('../../frontend/recovery/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /recoveryApi\.restartDesktop\(\)/, '重启按钮应走应用级重启')
  assert.doesNotMatch(app, /copy\.restart, async \(\) => \{ await recoveryApi\.returnToWorkbench/, '重启不得再接到 returnToWorkbench')
  assert.match(app, /variant='default'/, '重启是主操作（无需 server 就绪门槛）')
})

test('恢复页返回工作台会先确认 DSH 页面可用再切换视图', async () => {
  // These behaviors moved from main.ts to the recovery service. The delegator in
  // main.ts is a one-liner; the actual logic lives in recovery-service.ts.
  const recSvc = await readFile(new URL('../../src/recovery/recovery-service.ts', import.meta.url), 'utf8')
  assert.match(recSvc, /running === undefined\) throw new Error\('DSH 尚未成功启动/)
  assert.match(recSvc, /await deps\.navigate\(view, \(\) => deps\.loadURL\(view\.webContents, running\.url\)\)/)
  assert.match(recSvc, /advanceDiagnostic\(profileDir, 'renderer-loading'\)/)
  assert.match(recSvc, /startRendererHealthTimer\(profileDir\)/)
  assert.match(recSvc, /showDshContentView/)
  assert.match(recSvc, /window\?\.maximize\(\)\s+window\?\.show\(\)\s+window\?\.focus/)
  assert.match(recSvc, /if \(profileDir !== undefined\) await maybeLeaveRecoveryMode\(profileDir\)/)
})

test('恢复最近正常配置成功后退出恢复状态并直接进入工作台', async () => {
  const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  // The restore-and-return flow lives in the recovery service; main.ts routes through it.
  assert.match(main, /requireRecovery\(\)\.restartDsh\(profileDir, 'workbench'\)/)
  assert.match(main, /restoreProfileHealthCheckpoint\(profileDir\)/)
  assert.match(main, /leaveRecoveryMode\(profileDir\)/)
})

test('没有隔离插件时启动会自动退出恢复模式并进入工作台', async () => {
  const recSvc = await readFile(new URL('../../src/recovery/recovery-service.ts', import.meta.url), 'utf8')
  assert.match(recSvc, /if \(isRecoveryModeActive\(profileDir\)\) \{\s+if \(await maybeLeaveRecoveryMode\(profileDir\)\) \{\s+await deps\.createMainWindow\(serverUrl\)\s+return\s+\}\s+await showRecoveryWindow\(profileDir\)/)
  // Both launch sites now use the server returned by launchDsh rather than re-reading
  // the store, which is also what makes the read type-safe.
  const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  assert.match(main, /await openWorkbenchOrRecovery\(profileDir, started\.server\.url\)/)
  assert.match(main, /await openWorkbenchOrRecovery\(seedOptions\.profileDir, started\.server\.url\)/)
})

test('恢复模式中的健康启动不会覆盖最近正常配置检查点', async () => {
  const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  const healthyBranch = main.match(/if \(report\.status === 'healthy'\) \{([\s\S]*?)\n  \}/)?.[1]
  assert.ok(healthyBranch)
  assert.match(healthyBranch, /await completeStartupDiagnostic/)
  assert.match(healthyBranch, /await maybeLeaveRecoveryMode\(profileDir\)/)
  assert.match(healthyBranch, /if \(!isRecoveryModeActive\(profileDir\)\) \{\s+await captureProfileHealthCheckpoint\(profileDir\)/)
  assert.match(main, /beginStartupDiagnostic\(startupDiagnosticPath\(profileDir\), state\.diagnostics\.stage, \{\s+mode: isRecoveryModeActive\(profileDir\) \? 'recovery' : 'normal',?\s+\}\)/)
})

test('启动失败会被记录到 profile 的日志文件（恢复页据此展示）', async () => {
  const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  assert.match(main, /await reportStartupFailure\(error, profileDir\)/)
  assert.match(main, /join\(profileDir, '\.dsh-desktop-startup-error\.log'\)/)
  // The new UI reads that file through the typed API rather than the page reading it
  // directly — the renderer is sandboxed and has no filesystem access.
  const app = await readFile(new URL('../../frontend/recovery/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /recoveryApi\.getStartupLog\(\)/)
})

test('恢复页的配色跟随 DSH 主题，而不是操作系统颜色模式', async () => {
  const styles = await readFile(new URL('../../frontend/recovery/styles.css', import.meta.url), 'utf8')
  const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, '')
  // THE deliberate difference from the reference implementation. The app follows the
  // user's DSH theme, which can disagree with the OS; the legacy page used
  // `prefers-color-scheme` and would now disagree with the rest of the app.
  assert.match(withoutComments, /\[data-color-scheme='dark'\]/)
  assert.doesNotMatch(withoutComments, /@media[^{]*prefers-color-scheme/)
  assert.doesNotMatch(styles, /--danger-fill/, '旧页面的手写变量不应残留')
})

test('桌面壳预加载脚本被编译并提供 DSH 动作兜底', async () => {
  const config = await readFile(new URL('../../tsconfig.json', import.meta.url), 'utf8')
  const preload = await readFile(new URL('../../src/dsh-view-preload.cts', import.meta.url), 'utf8')
  assert.match(config, /src\/\*\*\/\*\.cts/)
  assert.match(preload, /clientBridgeRegistrations/)
  assert.match(preload, /runDomAction/)
  assert.match(preload, /添加工作区\|打开文件夹/)
  assert.match(preload, /\.dcu-wb-session\[role="treeitem"\]\[aria-selected\]/)
  assert.match(preload, /\^新建任务\$/)
})

test('桌面菜单使用窗口内坐标且 DSH 客户端桥接导出标准插件入口', async () => {
  const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  const bridge = await readFile(new URL('../../src/bridge/desktop-bridge-client-source.ts', import.meta.url), 'utf8')
  const dshPreload = await readFile(new URL('../../src/dsh-view-preload.cts', import.meta.url), 'utf8')
  assert.match(main, /x: Math\.round\(request\.x\),\s+y: Math\.round\(request\.y\)/)
  assert.doesNotMatch(main, /contentBounds\.x \+ Math\.round\(request\.x\)/)
  assert.match(bridge, /window\.__ModuleLoader__\.load/)
  assert.match(bridge, /const inject/)
  assert.match(bridge, /const apply/)
  assert.match(bridge, /ctx\.workspaces\.startSession\(\)/)
})

test('关于窗口使用独立丰富页面并进入打包资源', async () => {
  const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  const manifest = await readFile(new URL('../../package.json', import.meta.url), 'utf8')
  // The about window is React now, so its source is the component and its
  // shipped artifact is the Vite build output.
  const about = await readFile(new URL('../../frontend/shell/AboutWindow.tsx', import.meta.url), 'utf8')
  // Dialog window construction now lives in the dialog service.
  const dialogs = await readFile(new URL('../../src/desktop/dialog-service.ts', import.meta.url), 'utf8')
  assert.match(main, /showAboutWindow\(\)/)
  assert.match(manifest, /dist\/frontend\/shell/)
  assert.match(about, /关于这个项目/)
  assert.match(about, /runtimeVersion/)
  assert.match(dialogs, /resizable: false/)
  assert.match(dialogs, /frame: false/)
  assert.match(dialogs, /minimizable: false/)
  assert.match(dialogs, /maximizable: false/)
  assert.match(dialogs, /function preventWindowsOwnedWindowFlash/)
  assert.match(dialogs, /window\.setParentWindow\(null\)/)
})

test('桌面通知和更新设置使用独立窗口并进入打包资源', async () => {
  const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  const manifest = await readFile(new URL('../../package.json', import.meta.url), 'utf8')
  const settings = await readFile(new URL('../../frontend/shell/SettingsWindow.tsx', import.meta.url), 'utf8')
  // Notification construction and the Windows toast identity live in the service.
  const notifications = await readFile(new URL('../../src/desktop/notification-service.ts', import.meta.url), 'utf8')
  assert.match(main, /showDesktopSettingsWindow\(\)/)
  assert.match(notifications, /new Notification\(/)
  assert.match(notifications, /ensureWindowsNotificationIdentity\(\)/)
  assert.match(notifications, /toastActivatorClsid:/)
  assert.match(notifications, /hasReply: true/)
  assert.match(notifications, /buildWindowsReplyToastXml/)
  assert.match(notifications, /Notification\.handleActivation/)
  assert.match(notifications, /parseWindowsNotificationReplyActivation/)
  assert.match(notifications, /replyArguments: windowsNotificationReplyArguments\(event\.sessionId\)/)
  assert.match(notifications, /replyLabel: zh \? '回复' : 'Reply'/)
  assert.match(notifications, /`\$\{status\} · \$\{event\.title\}`/)
  assert.match(notifications, /supportsReply && process\.platform !== 'win32'/)
  assert.match(notifications, /writeShortcutLink\(/)
  assert.match(notifications, /setOverlayIcon\(/)
  // The toast activator CLSID is still registered on the app at startup.
  assert.match(main, /setToastActivatorCLSID/)
  assert.match(manifest, /dist\/frontend\/shell/)
  assert.match(manifest, /assets\/task-badges/)
  assert.match(settings, /任务完成通知/)
  assert.match(settings, /approvalsEnabled/)
  assert.match(settings, /questionsEnabled/)
  assert.match(settings, /Listbox/)
  assert.doesNotMatch(settings, /<select/)
  // The hand-rolled listbox lives in its own primitive and keeps its full ARIA
  // contract. `role="listbox"`/`role="option"` are what make it announce
  // correctly, so they are asserted where they are actually written.
  const listbox = await readFile(new URL('../../frontend/shell/Listbox.tsx', import.meta.url), 'utf8')
  assert.match(listbox, /role="listbox"/)
  assert.match(listbox, /role="option"/)
  assert.match(listbox, /aria-selected/)
  assert.match(listbox, /aria-expanded/)
  assert.match(listbox, /className="select-menu"/)
  assert.match(listbox, /className="select-option"/)
  assert.match(main, /mayReportDshLocale/)
  assert.match(main, /broadcastShellBootstrap/)
  assert.match(settings, /onBootstrap/)
  assert.match(settings, /auto-download/)
  assert.match(settings, /'manual'/)
  assert.match(settings, /updateUpdatePreferences/)
  assert.match(settings, /desktopUpdateAction/)
  assert.match(settings, /closeDesktopSettings/)
  // The close-desktop-settings channel is registered by the shell IPC registrar.
  const shellIpc = await readFile(new URL('../../src/desktop/shell-ipc-registrar.ts', import.meta.url), 'utf8')
  assert.match(shellIpc, /SHELL_IPC\.closeDesktopSettings/)
  assert.match(settings, /api\.onDesktopUpdateState/)
  assert.match(settings, /安装前始终由你确认/)
  assert.match(settings, /Installation always requires your confirmation/)
  // The update toast and updater configuration live in the update service.
  const updateService = await readFile(new URL('../../src/desktop/update-service.ts', import.meta.url), 'utf8')
  assert.match(updateService, /showDesktopSettingsWindow\('updates'\)/)
  assert.match(updateService, /autoInstallOnAppQuit = false/)
  // Menu stripping is part of the shared dialog window template.
  const dialogs = await readFile(new URL('../../src/desktop/dialog-service.ts', import.meta.url), 'utf8')
  assert.match(dialogs, /function removeNativeWindowMenu/)
  assert.match(dialogs, /window\.setMenu\(null\)/)
  assert.match(dialogs, /window\.setMenuBarVisibility\(false\)/)
  // The template applies it once, and all three dialogs go through the template —
  // so every created window still gets its menu stripped despite the single call.
  assert.equal((dialogs.match(/removeNativeWindowMenu\(window\)/g) ?? []).length, 1)
  assert.equal((dialogs.match(/openDialogWindow\(/g) ?? []).length, 4)
})

test('shell 在 macOS 为交通灯预留空间且状态早到不会读取空 bootstrap', async () => {
  // The bar is React now; the macOS inset lives in the stylesheet and the
  // "don't render before bootstrap" guard is the `undefined` early return.
  const bar = await readFile(new URL('../../frontend/shell/styles/bar.css', import.meta.url), 'utf8')
  const component = await readFile(new URL('../../frontend/shell/ShellBar.tsx', import.meta.url), 'utf8')
  assert.match(bar, /html\[data-platform="darwin"\] \.bar\s*\{[^}]*padding-left:\s*80px/)
  assert.match(component, /if \(bootstrap === undefined\) return null/)
})

test('原生菜单关闭后才清理外壳菜单的选中状态', async () => {
  const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  const component = await readFile(new URL('../../frontend/shell/ShellBar.tsx', import.meta.url), 'utf8')
  assert.match(main, /function popupShellMenu\(request: ShellMenuPopupRequest\): Promise<void>/)
  assert.match(main, /menu\.once\('menu-will-close', close\)/)
  assert.match(main, /callback: close/)
  // The open-tool state is cleared in a `finally`, so a rejected popup cannot
  // leave the button stuck in `aria-expanded="true"`.
  assert.match(component, /try \{\s*await shellBridge\(\)\.popupTool\([\s\S]*?\} finally \{/)
  assert.match(component, /addEventListener\('pointerdown', clear, true\)/)
})

test('DSH 主题变化同步到桌面外壳、原生菜单和辅助窗口', async () => {
  const main = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8')
  const bridge = await readFile(new URL('../../src/bridge/desktop-bridge-client-source.ts', import.meta.url), 'utf8')
  const dshPreload = await readFile(new URL('../../src/dsh-view-preload.cts', import.meta.url), 'utf8')
  // Theme application now lives in the broadcast service and the shared theme
  // contract, rather than in five hand-written documents.
  const broadcast = await readFile(new URL('../../src/desktop/shell-broadcast-service.ts', import.meta.url), 'utf8')
  const bar = await readFile(new URL('../../frontend/shell/styles/bar.css', import.meta.url), 'utf8')
  assert.doesNotMatch(bridge, /inject = \[[^\]]*'theme'/)
  assert.match(dshPreload, /reportDocumentTheme/)
  assert.match(dshPreload, /attributeFilter: \['style'\]/)
  assert.match(broadcast, /nativeTheme\.themeSource = preference/)
  /*
   * The native caption-button overlay is GONE. It could only paint a solid
   * color, so it could not follow the bar's gradient and produced a visible
   * seam against the renderer-drawn icons beside it. The buttons are drawn by
   * `WindowControls.tsx` now, which is why the palette's symbol color is shipped
   * through the bootstrap instead of pushed into Electron.
   */
  assert.doesNotMatch(broadcast, /\.setTitleBarOverlay\(/)
  assert.doesNotMatch(await readFile(new URL('../../src/desktop/window-registry.ts', import.meta.url), 'utf8'), /titleBarOverlay:\s*\{/)
  assert.match(broadcast, /titleBar: \{ background: palette\.titleBarBackground, symbol: palette\.titleBarSymbol \}/)
  assert.match(bar, /linear-gradient\(180deg, #222423 0%, #1d201e 100%\)/)
  assert.match(bar, /linear-gradient\(180deg, #ffffff 0%, #f6f7f6 100%\)/)
  // Every window's stylesheet carries the light-theme block the theme contract
  // depends on. This is the property the old per-document assertion protected.
  for (const name of ['bar', 'settings', 'shortcuts', 'about', 'startup']) {
    const css = await readFile(new URL(`../../frontend/shell/styles/${name}.css`, import.meta.url), 'utf8')
    assert.match(css, /data-color-scheme="light"/)
  }
  // The DSH content view still receives the theme as a load-time query.
  assert.match(main, /loadFile\(html, \{ query: \{ theme: state\.shell\.colorScheme \} \}\)/)
})
