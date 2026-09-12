/**
 * Bundle entry for the keyboard-shortcuts window.
 *
 * MOUNTING MUST WAIT FOR THE DOM — see the identical note in
 * `frontend/recovery/main.tsx`. The bundle is a CLASSIC script (modules are
 * refused over `file://`), and Vite injects it into `<head>`, where it runs
 * BEFORE `<body>` exists. Mounting eagerly throws "missing #root" and the window
 * renders empty with no console error.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/shortcuts.css'
import { ShortcutsWindow } from './ShortcutsWindow.js'

function mount(): void {
  const host = document.getElementById('root')
  if (host === null) throw new Error('缺少 #root 挂载点')
  createRoot(host).render(<StrictMode><ShortcutsWindow /></StrictMode>)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true })
} else {
  mount()
}
