/**
 * React bindings over the shell bridge.
 *
 * Each hook owns one subscription and guarantees it is torn down on unmount.
 * That matters more here than in a web app: these renderers live in
 * `BrowserWindow`s that are hidden and shown rather than destroyed, so a
 * listener that outlives its component keeps firing into a stale closure.
 *
 * The bootstrap handshake is deliberately identical in every window:
 *
 *   1. subscribe (`onBootstrap`) — BEFORE requesting,
 *   2. then `getBootstrap()` for the current value.
 *
 * Subscribing first is what closes the race where the main process broadcasts
 * between the request and the listener registration; the reverse order can drop
 * a theme or locale change and leave the window on its initial guess.
 */

import { useEffect, useRef, useState } from 'react'

import { applyColorScheme, shellBridge } from './api.js'
import type { ShellBootstrap, ShellState } from './api.js'

/**
 * Subscribe to the shell bootstrap (locale, theme, version, platform).
 *
 * Returns `undefined` until the first value arrives. Renderers are expected to
 * treat that as "not ready yet" rather than rendering a default-locale frame
 * that would visibly flip a moment later.
 */
export function useShellBootstrap(): ShellBootstrap | undefined {
  const [bootstrap, setBootstrap] = useState<ShellBootstrap | undefined>(undefined)

  useEffect(() => {
    const api = shellBridge()
    let active = true
    const apply = (value: unknown): void => {
      if (!active) return
      setBootstrap(value as ShellBootstrap)
    }
    const unsubscribe = api.onBootstrap(apply)
    void api.getBootstrap().then(apply, () => undefined)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (bootstrap !== undefined) applyColorScheme(bootstrap.colorScheme)
  }, [bootstrap])

  return bootstrap
}

/** Subscribe to the transient shell state (reloading, zoom, navigation). */
export function useShellState(initial?: ShellState): ShellState | undefined {
  const [state, setState] = useState<ShellState | undefined>(initial)

  useEffect(() => {
    const api = shellBridge()
    let active = true
    const apply = (value: unknown): void => {
      if (active) setState(value as ShellState)
    }
    const unsubscribe = api.onState(apply)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return state
}

/**
 * Run an async bridge call and expose whether it is in flight.
 *
 * Used by the settings page, where a second click while a save is in flight
 * would otherwise interleave two reads of the same preference and let the
 * slower response win.
 */
export function useAsyncAction(): readonly [boolean, <T>(run: () => Promise<T>) => Promise<T | undefined>] {
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)

  useEffect(() => () => { mounted.current = false }, [])

  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    try {
      const result = await action()
      return result
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return [busy, run] as const
}
