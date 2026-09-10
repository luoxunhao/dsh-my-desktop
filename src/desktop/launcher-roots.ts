/**
 * Launcher-side resolution of the profile roots.
 *
 * WHY THIS EXISTS SEPARATELY FROM `profiles.ts`
 * ---------------------------------------------
 * `profiles.ts` belongs to the **bridge flat publish unit** — files shipped flat
 * into `resources/desktop-bridge/` and injected into the DSH CHILD process. Members
 * of that unit may only import their siblings, and the packaging guard enforces it.
 *
 * The data-directory choice is a LAUNCHER (main-process) concern: the child gets its
 * home through an explicit argument or through `DSH_HOME`. So the launcher resolves
 * the choice here, on its own side of the boundary, and hands the result to
 * `resolveProfileRoots()` as an explicit `home`.
 *
 * WHY IT MATTERS THAT EVERY LAUNCHER CALL SITE GOES THROUGH HERE
 * --------------------------------------------------------------
 * `main.ts`, `profile-actions-service` and the recovery entry points all need the
 * same answer. If one of them kept calling `resolveProfileRoots({ stateDir })`
 * directly, it would read `DSH_HOME`/`~/.dsh` and ignore the user's choice — the app
 * would appear to "sometimes" use the configured directory, which is far worse than
 * never honouring it.
 *
 * PRECEDENCE:
 *
 *   1. the data-directory state file — the user's explicit choice in the recovery page
 *   2. `DSH_HOME` / `~/.dsh`          — the fallback
 *
 * Step 1 beats step 2 deliberately: see `data-directory.ts`. An environment variable
 * silently overriding a setting the user just changed would make that setting look
 * broken, with no way to discover why.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import { resolveDataDirectory, type DataDirectoryLocation } from '../recovery/data-directory.js'
import { resolveProfileRoots, type ProfileRoots } from '../profiles/profiles.js'

/** The environment's home, or the platform default. Never the user's choice. */
function fallbackHome(): { home: string, source: 'default' | 'environment' } {
  return process.env.DSH_HOME === undefined
    ? { home: join(homedir(), '.dsh'), source: 'default' }
    : { home: process.env.DSH_HOME, source: 'environment' }
}

/**
 * Resolve where the launcher's DSH home is.
 *
 * A missing or corrupt state file falls back rather than throwing, so a bad state
 * file can never stop the app from starting. A state file pointing at a directory
 * that has since disappeared is reported and also falls back — but loudly, because
 * silently using a different home would surface far from the real cause.
 */
export function resolveLauncherDataDirectory(userDataDir: string): DataDirectoryLocation {
  const fallback = fallbackHome()
  try {
    return resolveDataDirectory(userDataDir, { fallbackHome: fallback.home, fallbackSource: fallback.source })
  } catch (error) {
    console.error('配置的数据目录不可用，暂时回退到默认位置。', error)
    return { homeDir: fallback.home, previousHome: null, generation: 0, source: fallback.source }
  }
}

/** Launcher profile roots, with the user's data-directory choice applied. */
export function resolveLauncherProfileRoots(userDataDir: string): ProfileRoots {
  return resolveProfileRoots({
    stateDir: userDataDir,
    home: resolveLauncherDataDirectory(userDataDir).homeDir,
  })
}
