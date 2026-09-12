/**
 * Bundle entry for the launcher's About window.
 *
 * MOUNTING MUST WAIT FOR THE DOM — see the identical note in
 * `src/recovery-ui/main.tsx` and `shell-entry.tsx`. The bundle is a CLASSIC
 * script (browsers refuse module scripts over `file://`), and Vite injects it
 * into `<head>`, where it runs BEFORE `<body>` exists. Mounting eagerly throws
 * "missing #root" and the window renders empty with no console error.
 *
 * The alternative — the `assets/about.html` habit of a bare
 * `document.getElementById('close')` at the end of the body — works only
 * because the inline script sits after the markup it queries. That guarantee
 * does not survive bundling, so it is replaced by the guard below.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/about.css'
import { AboutWindow } from './AboutWindow.js'

function mount(): void {
  const host = document.getElementById('root')
  if (host === null) throw new Error('缺少 #root 挂载点')
  createRoot(host).render(<StrictMode><AboutWindow /></StrictMode>)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true })
} else {
  mount()
}
