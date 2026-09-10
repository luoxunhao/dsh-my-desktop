/**
 * Opening the recovery page's config files in the operating system.
 *
 * WHY AN ALLOWLIST RATHER THAN A PATH PARAMETER
 * ---------------------------------------------
 * The recovery page is sandboxed and has no filesystem access. If the IPC accepted
 * a path from the renderer, that sandbox would be punctured: a compromised or merely
 * buggy page could name ANY file on the machine and have the main process open it.
 *
 * So the page sends an ACTION NAME, and the main process decides what that means.
 * The path is always derived from the launcher's own resolved directories, never
 * from the request. The reference implementation works the same way (a fixed action
 * vocabulary in its recovery window).
 *
 * WHY THE RETURN VALUE OF `openPath` MATTERS
 * ------------------------------------------
 * Electron's `shell.openPath` does NOT reject on failure — it resolves with an empty
 * string on success and a human-readable message otherwise. Ignoring that return
 * value turns every failure into a silent no-op, which is indistinguishable from a
 * broken button.
 *
 * WHY THIS DOES NOT IMPLEMENT AN EDITOR
 * -------------------------------------
 * Editing config in-page would mean owning syntax highlighting, encoding, concurrent
 * writes and crash recovery. Handing the file to the user's own editor is both
 * smaller and better, and it is what the reference does.
 */
import { existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'

/** The fixed set of things the recovery page may ask to open. */
export const RECOVERY_OPEN_TARGETS = [
  'settings-document',
  'profile-patch',
  'profile-manifest',
  'profile-directory',
] as const

export type RecoveryOpenTarget = typeof RECOVERY_OPEN_TARGETS[number]

export interface RecoveryOpenContext {
  /** The resolved DSH home (which may not be `~/.dsh` — see data-directory.ts). */
  readonly homeDir: string
  /** The active profile directory. */
  readonly profileDir: string
}

/** Opens a path in the OS; resolves with `''` on success, else a message. */
export type OpenPathAdapter = (path: string) => Promise<string>

function isKnownTarget(value: string): value is RecoveryOpenTarget {
  return (RECOVERY_OPEN_TARGETS as readonly string[]).includes(value)
}

/**
 * Resolve an action name to the path it means.
 *
 * Kept separate from opening so the mapping can be asserted directly — an unknown
 * name must never silently fall through to "open nothing" OR "open something".
 */
export function resolveRecoveryOpenPath(target: RecoveryOpenTarget, context: RecoveryOpenContext): string {
  switch (target) {
    case 'settings-document': return join(context.homeDir, 'settings.yaml')
    case 'profile-patch': return join(context.profileDir, 'cordis.patch.yml')
    case 'profile-manifest': return join(context.profileDir, 'package.json')
    case 'profile-directory': return context.profileDir
  }
}

/**
 * Open one of the allowlisted targets.
 *
 * Rejects for an unknown action, a missing file, or an opener-reported failure —
 * every one of which the page surfaces to the user rather than swallowing.
 */
export async function openRecoveryTarget(
  target: string,
  context: RecoveryOpenContext,
  openPath: OpenPathAdapter,
): Promise<void> {
  if (!isKnownTarget(target)) {
    throw new Error(`unknown recovery open target: ${JSON.stringify(target)}`)
  }
  const path = resolveRecoveryOpenPath(target, context)
  // The directory target legitimately points at a directory; the rest must be real
  // files, so a stale path is reported instead of opening an empty editor.
  if (!existsSync(path)) {
    throw new Error(`recovery target does not exist: ${path}`)
  }
  if (target !== 'profile-directory' && !lstatSync(path).isFile()) {
    throw new Error(`recovery target is not a file: ${path}`)
  }
  const failure = await openPath(path)
  // `openPath` reports failure through its RESOLVED VALUE, not by rejecting.
  if (failure !== '') throw new Error(failure)
}
