import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles.css'
import { App } from './App'

/**
 * Entry point for the recovery window.
 *
 * MOUNTING MUST WAIT FOR THE DOM
 * ------------------------------
 * The bundle is a CLASSIC script (see vite.config.ts for why it cannot be a module:
 * modules are refused over `file://`). Vite injects a classic script into `<head>`,
 * and classic scripts run immediately — BEFORE `<body>` exists. Mounting eagerly
 * therefore throws "missing #root" and renders nothing, which is exactly what
 * happened before this guard was added.
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
