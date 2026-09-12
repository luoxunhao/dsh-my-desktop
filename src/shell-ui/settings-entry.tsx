/**
 * Bundle entry for the desktop settings window.
 *
 * The DOM-ready guard is required for the same reason as every other window:
 * the bundle is a classic script injected into `<head>`, so it runs before
 * `<body>` exists. See `src/recovery-ui/main.tsx`.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/settings.css'
import { SettingsWindow } from './SettingsWindow.js'

function mount(): void {
  const host = document.getElementById('root')
  if (host === null) throw new Error('缺少 #root 挂载点')
  createRoot(host).render(<StrictMode><SettingsWindow /></StrictMode>)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true })
} else {
  mount()
}
