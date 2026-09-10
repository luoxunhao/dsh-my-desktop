/**
 * Profile management and launcher-native desktop actions.
 *
 * WHAT IS HERE
 * ------------
 * Two related groups, both driven from outside the main process:
 *
 *   - **Profile operations** — list / create / select / delete, requested by the
 *     in-profile desktop settings plugin over the bridge IPC, plus the
 *     renderer-safe projection the settings page reads.
 *   - **Desktop actions** — relaunch, toggle DevTools, restart into recovery mode.
 *     These are the "only the Electron host can do this" side effects the settings
 *     plugin asks for.
 *
 * WHY THEY ARE ONE MODULE
 * -----------------------
 * They share the same trigger surface (bridge messages / the shell's action
 * dispatch) and the same small slice of state: the launch options recorded at
 * startup plus the DSH view for DevTools. Splitting them would produce two modules
 * that both need those fields and are always changed together.
 *
 * RECOVERY IS INJECTED, NOT IMPORTED
 * ----------------------------------
 * `restartIntoRecoveryFromShell` needs `restartDshInRecoveryMode`, which belongs to
 * the recovery flow (ticket 13). Importing it here would make this module depend on
 * a group that is itself scheduled to move, so it arrives as a callback instead —
 * the same cycle-avoidance rule used for the tray/updater and dialog windows.
 */
import { app } from 'electron'

import {
  assertProfileName,
  createProfileDirectory,
  deleteProfileDirectory,
  listProfiles,
  profileDirFor,
  readActiveProfile,
  resolveProfileRoots,
  writeActiveProfile,
} from '../profiles/profiles.js'
import { seedBundledPlugins } from '../profiles/plugin-seed.js'
import type { RetainedSeedOptions } from './desktop-state.js'

/** Renderer-safe view of one managed profile. */
export interface ProfileOperationView {
  readonly name: string
  readonly exists: boolean
  readonly webCapable: boolean
  readonly selectable: boolean
  readonly deletable: boolean
  readonly current: boolean
  readonly problem: string | null
}

export interface ProfileActionsDeps {
  /** Launch state recorded at startup; read at call time (late-bound). */
  lastSeedOptions: () => RetainedSeedOptions | undefined
  /** Quitting guard, read at call time. */
  isQuitting: () => boolean
  /** The DSH content view, for toggling DevTools. */
  dshView: () => { webContents: Electron.WebContents } | undefined
  /** Shut the desktop shell down, then run the given action (relaunch). */
  shutdown: (exit: () => void) => Promise<void>
  /** Restart the whole application into recovery mode (asks the user first). */
  requestRecoveryRestart: () => Promise<void>
}

export function createProfileActionsService(deps: ProfileActionsDeps) {
  /** Launcher profile registry roots (state under userData, profiles under DSH home). */
  function launcherProfileRoots(): ReturnType<typeof resolveProfileRoots> {
    return resolveProfileRoots({ stateDir: app.getPath('userData') })
  }

  /** Relaunch the whole desktop application (used after a profile switch). */
  async function restartDesktop(): Promise<void> {
    if (deps.isQuitting()) return
    await deps.shutdown(() => { app.relaunch(); app.exit() })
  }

  /** Read-only snapshot of the current managed profiles (for the shell/bridge). */
  function currentProfilesSnapshot(): ReadonlyArray<ReturnType<typeof listProfiles>[number]> {
    const roots = launcherProfileRoots()
    const active = readActiveProfile(roots)
    return listProfiles(roots, active)
  }

  /**
   * Create a new Web profile and seed it with the shared official runtime +
   * bundled plugins. It does NOT select the profile or require a relaunch; a
   * later select/switch starts it.
   */
  async function createWebProfile(name: string): Promise<void> {
    assertProfileName(name)
    const roots = launcherProfileRoots()
    createProfileDirectory(roots, name)
    const seed = deps.lastSeedOptions()
    if (seed === undefined) throw new Error('启动尚未完成，无法创建 profile。')
    // Reuse the current node/pnpm/store plumbing against the new profile dir.
    await seedBundledPlugins({ ...seed, profileDir: profileDirFor(roots.home, name) })
  }

  /**
   * Select a compatible profile to be active on the next launch, then relaunch
   * the whole desktop application so it starts the newly selected profile.
   */
  async function switchWebProfile(name: string): Promise<void> {
    const roots = launcherProfileRoots()
    const target = listProfiles(roots, readActiveProfile(roots)).find((profile) => profile.name === name)
    if (target === undefined) throw new Error(`profile ${JSON.stringify(name)} does not exist`)
    if (!target.selectable) throw new Error(`profile ${JSON.stringify(name)} is not a launchable Web profile`)
    writeActiveProfile(roots, name)
    await restartDesktop()
  }

  /** Delete a non-active profile directory (fails closed on the active one). */
  function deleteWebProfile(name: string): void {
    const roots = launcherProfileRoots()
    deleteProfileDirectory(roots, name, readActiveProfile(roots))
  }

  /** Renderer-safe view of the managed profiles. */
  function desktopProfileViews(): readonly ProfileOperationView[] {
    return currentProfilesSnapshot().map((profile) => ({
      name: profile.name,
      exists: profile.exists,
      webCapable: profile.webCapable,
      selectable: profile.selectable,
      deletable: profile.deletable,
      current: profile.name === readActiveProfile(launcherProfileRoots()),
      problem: profile.problem,
    }))
  }

  /** Enter recovery isolation and restart DSH into the recovery window. */
  /**
   * Enter recovery isolation and restart the whole application into recovery mode.
   *
   * This used to restart the DSH child IN-PROCESS and write an isolation flag into
   * the profile. That cannot help when the app itself will not start, and it is not
   * what the reference implementation does. Recovery is now a property of a NEW
   * APPLICATION GENERATION: `restartService` relaunches Electron with a one-shot
   * marker, and the next process boots the recovery assistant instead of the host.
   *
   * Note there is therefore no `enterRecoveryMode` call here any more — the new
   * process decides, from the marker, before any host starts.
   */
  async function restartIntoRecoveryFromShell(): Promise<void> {
    await deps.requestRecoveryRestart()
  }

  /** Toggle DevTools on the DSH renderer. */
  function toggleDeveloperTools(): void {
    const contents = deps.dshView()?.webContents
    if (contents !== undefined && !contents.isDestroyed()) contents.toggleDevTools()
  }

  return {
    launcherProfileRoots,
    restartDesktop,
    currentProfilesSnapshot,
    createWebProfile,
    switchWebProfile,
    deleteWebProfile,
    desktopProfileViews,
    restartIntoRecoveryFromShell,
    toggleDeveloperTools,
  }
}

export type ProfileActionsService = ReturnType<typeof createProfileActionsService>
