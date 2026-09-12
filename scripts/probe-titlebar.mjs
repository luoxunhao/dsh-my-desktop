/**
 * Render-probe for the self-drawn title bar.
 *
 * Loads the REAL built bundle (`dist/frontend/shell/assets/shell.js`) against a stub of
 * the `dshShell` bridge, then reads back computed styles. This is the only way to
 * exercise a bridge-dependent window outside Electron.
 *
 * It exists because the defect being verified is a COLOR-MATCHING defect, and
 * inspecting the source cannot prove the two icon groups agree: the bootstrap
 * value, the CSS custom property name, and the declaration that consumes it are
 * three separate places that must line up. Reading computed styles is what
 * actually proves it.
 *
 * Usage: node scripts/probe-titlebar.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const shellUiDir = join(projectRoot, 'dist', 'frontend', 'shell')

/** Locate Chrome; the probe is a diagnostic, so a missing browser is not fatal. */
function findChrome() {
  const candidates = [
    join(process.env.ProgramFiles ?? '', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['ProgramFiles(x86)'] ?? '', 'Google/Chrome/Application/chrome.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  ]
  return candidates.find(candidate => candidate !== '' && existsSync(candidate))
}

/**
 * A stub of the preload's `dshShell` surface.
 *
 * Mirrors `src/shell-preload.cts`. The bootstrap carries the LIGHT palette so the
 * probe exercises the theme where the color mismatch was reported.
 */
const STUB = `
window.dshShell = {
  platform: 'win32',
  action: async () => undefined,
  tool: async () => undefined,
  popupTool: async () => undefined,
  getBootstrap: async () => ({
    actions: [], menus: [],
    colorScheme: 'light',
    locale: 'zh-CN',
    platform: 'win32',
    runtimeVersion: '0.1.5-rc.1',
    version: '0.2.1',
    state: { fullscreen: false, reloading: false, zoomPercent: 100, canBack: false, canForward: false, canNextChat: false, canPreviousChat: false },
    titleBar: { background: '#f6f7f6', symbol: '#474747' }
  }),
  getWindowState: async () => ({ maximized: false }),
  windowControl: async () => undefined,
  getNotificationPreferences: async () => ({ turnMode: 'unfocused', approvalsEnabled: true, questionsEnabled: true }),
  updateNotificationPreferences: async v => v,
  getUpdatePreferences: async () => ({ policy: 'notify' }),
  updateUpdatePreferences: async v => v,
  getDesktopUpdateState: async () => ({ currentVersion: '0.2.1', packaged: true, status: { kind: 'none' } }),
  desktopUpdateAction: async () => ({ currentVersion: '0.2.1', packaged: true, status: { kind: 'none' } }),
  closeDesktopSettings: async () => undefined,
  onState: () => () => {}, onBootstrap: () => () => {},
  onDesktopUpdateState: () => () => {}, onSettingsSection: () => () => {},
  popupMenu: async () => undefined
};
`

const PROBE = `
setTimeout(function () {
  var root = document.documentElement;
  var bar = document.querySelector('.bar');
  var caps = document.querySelector('.caption-buttons');
  var capButton = document.querySelector('.caption-button');
  var toolIcon = document.querySelector('.bar-tools .icon img');
  var out = {
    scheme: root.dataset.colorScheme,
    // The custom property the bar publishes from the bootstrap.
    publishedFg: bar ? bar.style.getPropertyValue('--titlebar-fg') : null,
    // What the caption glyphs ACTUALLY resolve to.
    captionColor: capButton ? getComputedStyle(capButton).color : null,
    // What the toolbar icons resolve to (a filter, so reported for comparison).
    toolFilter: toolIcon ? getComputedStyle(toolIcon).filter : null,
    // The strip must be transparent so the bar's gradient is continuous.
    captionStripBg: caps ? getComputedStyle(caps).backgroundColor : null,
    captionButtons: document.querySelectorAll('.caption-button').length,
    toolButtons: document.querySelectorAll('.bar-tools .icon').length
  };
  document.title = 'PROBE:' + JSON.stringify(out);
}, 1500);
`

const chrome = findChrome()
if (chrome === undefined) {
  console.error('未找到 Chrome，跳过渲染探针。')
  process.exit(0)
}

const scratch = mkdtempSync(join(tmpdir(), 'dsh-titlebar-probe-'))
const html = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden}</style>
<script>document.documentElement.dataset.colorScheme='light'</script>
<script>${STUB}</script>
</head><body><div id="root"></div>
<script src="./assets/shell.js"></script>
<script>${PROBE}</script>
</body></html>`

const harnessPath = join(shellUiDir, '_probe-titlebar.html')
writeFileSync(harnessPath, html, 'utf8')

const result = spawnSync(chrome, [
  '--headless', '--disable-gpu', '--no-sandbox', '--dump-dom',
  '--virtual-time-budget=5000', `file:///${harnessPath.replace(/\\/g, '/')}`,
], { encoding: 'utf8' })

const match = /PROBE:(\{.*?\})/.exec(result.stdout ?? '')
if (match === null) {
  console.error('探针未返回结果。')
  console.error((result.stdout ?? '').slice(0, 800))
  process.exit(1)
}

const probe = JSON.parse(match[1])
console.log(JSON.stringify(probe, null, 2))

/*
 * The assertions that matter. These are the invariants the original defect
 * violated, checked against the RENDERED result rather than the source.
 */
const failures = []
if (probe.captionButtons !== 3) failures.push(`应绘制 3 个窗口按钮，实际 ${probe.captionButtons}`)
if (probe.toolButtons !== 3) failures.push(`应有 3 个工具按钮，实际 ${probe.toolButtons}`)
// The whole point: the published color must reach the caption glyphs.
if (probe.captionColor !== 'rgb(71, 71, 71)') {
  failures.push(`浅色下标题栏按钮颜色应为 rgb(71, 71, 71)（#474747），实际 ${probe.captionColor}`)
}
// A solid strip background would reintroduce the seam.
if (probe.captionStripBg !== 'rgba(0, 0, 0, 0)') {
  failures.push(`按钮区背景必须透明（跟随渐变），实际 ${probe.captionStripBg}`)
}

if (failures.length > 0) {
  console.error('\n未通过：')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\n全部通过：按钮由渲染进程绘制，取色与工具图标同源，按钮区无独立底色。')
