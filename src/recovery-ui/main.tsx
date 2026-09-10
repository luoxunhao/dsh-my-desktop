import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import './styles.css'
import { PrimitivesShowcase } from './PrimitivesShowcase'

/**
 * Minimal recovery page — the build-chain smoke test.
 *
 * This is deliberately NOT the recovery UI. Its only job is to prove, on both the
 * dev and packaged paths, that:
 *
 *   - Vite + React + Tailwind compile and load under the strict CSP,
 *   - relative asset URLs resolve from `file://`,
 *   - the recovery preload's IPC surface is actually reachable from this page.
 *
 * The IPC round-trip matters most: it is the one thing that would fail silently if
 * the preload were not wired to this document, and it is the channel the real UI
 * will depend on entirely.
 */

interface RecoveryBridge {
  getStatus?: () => Promise<unknown>
}

declare global {
  interface Window {
    dshRecovery?: RecoveryBridge
  }
}

type Probe =
  | { readonly state: 'pending' }
  | { readonly state: 'ok', readonly detail: string }
  | { readonly state: 'failed', readonly detail: string }

function App(): React.JSX.Element {
  const [probe, setProbe] = useState<Probe>({ state: 'pending' })

  useEffect(() => {
    let cancelled = false
    const bridge = window.dshRecovery
    if (bridge?.getStatus === undefined) {
      setProbe({ state: 'failed', detail: 'window.dshRecovery.getStatus 不存在 —— preload 未接通' })
      return
    }
    void bridge.getStatus()
      .then(status => {
        if (cancelled) return
        setProbe({ state: 'ok', detail: JSON.stringify(status ?? null).slice(0, 400) })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setProbe({ state: 'failed', detail: error instanceof Error ? error.message : String(error) })
      })
    return () => { cancelled = true }
  }, [])

  return (
    <main className="flex h-full flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">DSH My Desktop — 恢复页（构建链验证）</h1>
      <p className="text-sm" style={{ color: 'var(--color-content-muted)' }}>
        此页仅用于验证 Vite + React + Tailwind 构建链与 IPC 通道，不是最终的恢复界面。
      </p>
      <section className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-surface)' }}>
        <h2 className="text-sm font-medium">IPC 探测</h2>
        <pre className="mt-2 whitespace-pre-wrap break-all text-xs">{probe.state === 'pending' ? '进行中…' : `${probe.state === 'ok' ? '成功' : '失败'}：${probe.detail}`}</pre>
      </section>
    </main>
  )
}

/**
 * Mount only once the document is parsed.
 *
 * The bundle is a CLASSIC script (see vite.config.ts) and Vite injects it into
 * `<head>`. A classic script runs immediately when encountered, which is BEFORE
 * `<body>` — and therefore before `#root` exists. A module script would have been
 * deferred automatically, but modules cannot load over `file://`.
 *
 * Without this guard the page throws "missing #root" and renders empty, which is
 * exactly what happened before the fix.
 */
function mount(): void {
  const host = document.getElementById('root')
  if (host === null) throw new Error('缺少 #root 挂载点')
  createRoot(host).render(<StrictMode><App /></StrictMode>)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true })
} else {
  mount()
}
