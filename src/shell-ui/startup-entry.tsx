/**
 * Bundle entry for the startup / blocking-status window.
 *
 * The DOM-ready guard is required for the same reason as every other window:
 * the bundle is a classic script injected into `<head>`, so it runs before
 * `<body>` exists. See `src/recovery-ui/main.tsx`.
 *
 * Note that this window reads its theme from the URL rather than a bridge — see
 * `StartupWindow.tsx`.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/startup.css'
import { StartupWindow } from './StartupWindow.js'

function mount(): void {
  const host = document.getElementById('root')
  if (host === null) throw new Error('缺少 #root 挂载点')
  createRoot(host).render(<StrictMode><StartupWindow /></StrictMode>)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true })
} else {
  mount()
}
