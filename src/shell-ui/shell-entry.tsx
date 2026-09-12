/**
 * Bundle entry for the launcher's title bar.
 *
 * MOUNTING MUST WAIT FOR THE DOM — see the identical note in
 * `src/recovery-ui/main.tsx`. The bundle is a CLASSIC script (modules are
 * refused over `file://`), and Vite injects it into `<head>`, where it runs
 * BEFORE `<body>` exists. Mounting eagerly throws "missing #root" and the window
 * renders empty with no console error.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/bar.css'
import { ShellBar } from './ShellBar.js'

function mount(): void {
  const host = document.getElementById('root')
  if (host === null) throw new Error('缺少 #root 挂载点')
  createRoot(host).render(<StrictMode><ShellBar /></StrictMode>)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true })
} else {
  mount()
}
