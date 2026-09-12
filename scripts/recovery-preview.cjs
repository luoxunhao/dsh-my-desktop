// Render the REAL recovery page with a mock bridge, so a screenshot can be compared
// against dsh-desktop's reference UI. Test scaffolding, not a product harness:
//   node scripts/recovery-preview.cjs [outDir]
const fs = require('node:fs')
const path = require('node:path')

const outDir = process.argv[2] ?? path.join('.scratch', 'recovery-preview')
const dist = path.join('dist', 'frontend', 'recovery')
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const bundleName = fs.readdirSync(path.join(dist, 'assets')).find(name => name.endsWith('.js'))
const bundle = fs.readFileSync(path.join(dist, 'assets', bundleName), 'utf8')

// A snapshot pair from a profile with plugins, plus an empty slot — the shape the
// page must render for the 1:1 comparison (three slots, no profile on the cards).
const MOCK = `window.dshRecovery = {
  getStatus: async () => ({ active: false, running: false, isolated: [], candidates: [], suspectedPlugin: null }),
  listCheckpoints: async () => [
    { slotId: 'slot-1', status: 'available', profileName: 'desktop', capturedAt: '2026-09-11T10:00:47.000Z', appVersion: '2.0.5', pluginCount: 7, fileCount: 6, totalBytes: 85811 },
    { slotId: 'slot-2', status: 'available', profileName: 'desktop', capturedAt: '2026-09-10T22:12:06.000Z', appVersion: '2.0.4', pluginCount: 3, fileCount: 6, totalBytes: 12712 },
    { slotId: 'slot-3', status: 'empty', profileName: 'desktop' },
  ],
  listProfiles: async () => [{ name: 'desktop', current: true, selectable: true, deletable: false, exists: true, webCapable: true, problem: null }],
  getStartupLog: async () => '',
  dataDirectory: async () => ({ currentDirectory: 'C:\\\\Users\\\\admin\\\\.dsh', usingDefaultDirectory: true, source: 'default' }),
  selectDataDirectory: async () => ({}),
  factoryReset: async () => ({}),
  openTarget: async () => {},
  inspectCheckpoint: async () => ({}),
  restoreCheckpoint: async () => {},
  returnToWorkbench: async () => {},
  restore: async () => {},
  uninstall: async () => {},
  keepIsolated: async () => {},
  activate: async () => {},
};
`

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true })
fs.writeFileSync(path.join(outDir, 'assets', 'mock.js'), MOCK)
fs.writeFileSync(path.join(outDir, 'assets', 'index.js'), bundle)
fs.writeFileSync(
  path.join(outDir, 'index.html'),
  html.replace(
    '<script src="./assets/index.js"></script>',
    '<script src="./assets/mock.js"></script><script src="./assets/index.js"></script>',
  ),
)
console.log('recovery preview:', path.resolve(outDir, 'index.html'))
