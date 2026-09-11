// Render each panel in isolation, so every one can be verified without the app.
// Test scaffolding only.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles.css'
import { DiagnosticsPanel } from './panels/DiagnosticsPanel.js'
import { PluginsPanel } from './panels/PluginsPanel.js'
import { ProfilesPanel } from './panels/ProfilesPanel.js'
import { ReasonCard } from './panels/ReasonCard.js'
import { RollbackPanel } from './panels/RollbackPanel.js'

/**
 * Slots from BOTH profiles on purpose: that is the real shape the page now receives
 * (the rollback panel aggregates every profile's slots and labels each with the
 * profile it came from). A single-profile fixture would hide the very bug this
 * panel was rebuilt to fix.
 */
const slots = [
  { slotId: 'slot-1' as const, status: 'available' as const, profileName: 'desktop', capturedAt: '2026-09-10T11:22:12.075Z', appVersion: '0.1.4', fileCount: 7, totalBytes: 12_840 },
  { slotId: 'slot-2' as const, status: 'available' as const, profileName: 'desktop', capturedAt: '2026-09-10T09:05:41.000Z', appVersion: '0.1.3', fileCount: 7, totalBytes: 12_712 },
  { slotId: 'slot-3' as const, status: 'empty' as const, profileName: 'desktop' },
  { slotId: 'slot-1' as const, status: 'available' as const, profileName: 'web', capturedAt: '2026-09-10T08:14:03.000Z', appVersion: '0.1.4', fileCount: 7, totalBytes: 4_512 },
  { slotId: 'slot-2' as const, status: 'empty' as const, profileName: 'web' },
  { slotId: 'slot-3' as const, status: 'empty' as const, profileName: 'web' },
]

const profiles = [
  { name: 'desktop', current: true, selectable: true, deletable: false, exists: true, webCapable: true, problem: null },
  { name: 'web', current: false, selectable: true, deletable: true, exists: true, webCapable: true, problem: null },
]

const status = {
  active: false,
  running: false,
  isolated: [{ packageName: 'dsh-context' }, { packageName: 'dsh-vision-router' }],
  suspectedPlugin: 'dsh-context',
  failureMessage: 'Error: plugin tree failed to load',
  candidates: [{ packageName: 'dsh-context' }],
}

const noop = (): void => {}

/** All panels at once, so one screenshot covers every one. */
export function PanelsPreview(): React.JSX.Element {
  return (
    <div className="h-screen space-y-6 overflow-auto p-5">
      <ReasonCard status={status} requested={false} />
      <PluginsPanel status={status} busy={false} onUninstall={noop} onRestore={noop} onKeepIsolated={noop} />
      <RollbackPanel
        slots={slots}
        inspections={{ 'slot-1': { slotId: 'slot-1', snapshotExists: true, currentDiffers: true, changedFiles: ['package.json', 'cordis.patch.yml'] } }}
        locale="zh"
        busy={false}
        onInspect={noop}
        onRestore={noop}
      />
      <ProfilesPanel profiles={profiles} />
      <DiagnosticsPanel startupLog={'DSH 提前退出（退出码 1）。\nError: service "desktopProfiles" has been registered\n  at runProfile (profile-boot.js:261:14)'} />
    </div>
  )
}

/**
 * Mount only once the document is parsed — the bundle is a classic script injected
 * into `<head>`, so it runs before `<body>` exists. Same requirement as `main.tsx`;
 * mounting eagerly here threw "missing #root" and rendered nothing.
 */
function mount(): void {
  const host = document.getElementById('root')
  if (host === null) throw new Error('缺少 #root')
  createRoot(host).render(<StrictMode><PanelsPreview /></StrictMode>)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true })
} else {
  mount()
}
