/**
 * Opening a DSH terminal window on the active profile.
 *
 * THE NARROW-INTERFACE DEMONSTRATION
 * ----------------------------------
 * Every other extracted module takes a store slice (or a purpose-built deps
 * object) because it genuinely spans several concerns. This one does not: the
 * whole feature depends on exactly ONE store field, `lastSeedOptions`.
 *
 * So `TerminalDeps` declares only what it needs:
 *
 *     { lastSeedOptions: () => RetainedSeedOptions | undefined }
 *
 * Structural typing makes this free at the call site — the real store object is
 * passed once and matches — while the signature stays honest: a reader can see
 * that the terminal does not touch windows, updates, notifications or recovery.
 * This is the shape the remaining tickets should follow.
 *
 * The field is read through a getter because it is LATE-BOUND: the terminal can be
 * opened before the first launch has recorded its seed options.
 *
 * WHAT THE TERMINAL ACTUALLY DOES
 * -------------------------------
 * It writes a `dsh` shim into a per-profile state dir and injects it on the PATH of
 * the spawned terminal ONLY — the system PATH is never modified. The shim rewrites
 * argv so a bare `dsh` (and `dsh plugin …`) acts on the active profile, because the
 * official CLI wants `--profile <name>` on the subcommand rather than the parent.
 */
import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'

import { DESKTOP_APP_NAME } from '../app/app-identity.js'
import { isChineseLocale } from './shell-actions.js'
import { renderTerminalEntry } from './dsh-term.js'
import { readActiveProfile, resolveProfileRoots } from '../profiles/profiles.js'
import { resolveWebProfileDir } from '../profiles/plugin-seed.js'
import { resolveNodeExecutable } from '../runtime/runtime.js'
import type { RetainedSeedOptions } from './desktop-state.js'

export interface TerminalDeps {
  /** Only the launch state the terminal needs — nothing else from the store. */
  lastSeedOptions: () => RetainedSeedOptions | undefined
  /** Current shell locale, used to pick zh/en copy. */
  locale: () => string
  /** Where the launcher keeps its profile registry (for the active profile name). */
  profileRoots: () => ReturnType<typeof resolveProfileRoots>
}

export function createTerminalService(deps: TerminalDeps) {
  /** Append a terminal-open diagnostic to userData/terminal.log so failures are visible. */
  function logTerminalError(detail: string): void {
    try {
      const line = `[${new Date().toISOString()}] ${detail}\n`
      appendFileSync(join(app.getPath('userData'), 'terminal.log'), line, 'utf8')
    } catch { /* ignore */ }
  }

  function openDshTerminal(): void {
    try {
      const seed = deps.lastSeedOptions()
      const profileDir = seed?.profileDir ?? resolveWebProfileDir()
      // The app launches DSH with DSH_HOME = the `.dsh` root two levels above the
      // profile dir (see startDsh). Mirror that so `dsh` resolves the same home.
      const home = seed?.profileDir !== undefined ? resolve(profileDir, '..', '..') : app.getPath('home')
      const cwd = existsSync(profileDir) ? profileDir : existsSync(home) ? home : app.getPath('temp')
      // dsh CLI operates on the currently launched profile (the active profile).
      const profileName = seed?.profileDir !== undefined
        ? basename(seed.profileDir)
        : readActiveProfile(deps.profileRoots())
      const zh = isChineseLocale(deps.locale())

      // Expose the bundled `dsh` CLI as a `dsh` shim on PATH so profile commands
      // (e.g. `dsh plugin add <pkg>`) work exactly as in a native DSH terminal.
      // The official CLI requires `--profile <name>`. A thin wrapper rewrites argv
      // (see dsh-term.ts) so a bare `dsh`, `dsh web`, `dsh --dump-config` and
      // `dsh plugin …` all act on the active profile — placing the flag on the
      // `plugin`/`web` subcommand, never the parent, so plugin management works.
      const node = resolveNodeExecutable({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath })
      const nodeBinDir = dirname(node)
      let entry: string | undefined
      const entryCandidates = [
        seed?.desktopRuntimeDir,
        profileDir,
      ].filter((dir): dir is string => dir !== undefined)
      for (const root of entryCandidates) {
        const candidate = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
        if (existsSync(candidate)) { entry = candidate; break }
      }

      let shimDir: string | undefined
      let welcomePath: string | undefined
      if (entry !== undefined) {
        try {
          // Per-profile private state dir (stable, hashed), mirroring the reference
          // desktop-terminal state layout so a stale partial shim is never reused.
          const identity = createHash('sha256').update(profileName, 'utf8').digest('hex')
          const stateDir = join(app.getPath('userData'), 'cli', identity)
          shimDir = join(stateDir, 'bin')
          mkdirSync(shimDir, { recursive: true })
          // The official CLI requires `--profile <name>`, but its `plugin` (and
          // `web`) subcommand rejects a *parent-level* --profile. Prepending the
          // flag therefore breaks `dsh plugin add <pkg>` (see dsh-term.ts). Run a
          // thin self-contained wrapper that rewrites argv so `--profile web` lands
          // on the `plugin` subcommand itself, then boots the official entry.
          writeFileSync(join(shimDir, 'dsh-term.mjs'), renderTerminalEntry(profileName, entry), 'utf8')
          const termQuoted = join(shimDir, 'dsh-term.mjs').replace(/"/g, '""')
          const nodeQuoted = node.replace(/"/g, '""')
          if (process.platform === 'win32') {
            const shim = '@echo off\r\n"' + nodeQuoted + '" "' + termQuoted + '" %*\r\n'
            writeFileSync(join(shimDir, 'dsh.cmd'), shim, 'utf8')
            writeFileSync(join(shimDir, 'dsh.bat'), shim, 'utf8')
            // Welcome banner: cd into the profile and print the environment + hints.
            const profileDirCmd = profileDir.replace(/"/g, '""')
            const product = app.getVersion()
            const line = (text: string): string => '@echo ' + text.replace(/[<>&|^()%]/g, (m) => '^' + m) + '\r\n'
            const welcome = [
              '@echo off',
              // welcome.cmd is written as UTF-8 but cmd reads batch with the console
              // ANSI codepage, mojibaking the CJK banner. Switch to UTF-8 (65001)
              // before any non-ASCII echo so the banner renders; pure-ASCII lines
              // above it parse fine under any codepage.
              'chcp 65001 >nul',
              'cd /d "' + profileDirCmd + '"',
              line(''),
              line((zh ? 'DSH My Desktop ' : 'DSH My Desktop ') + product + (zh ? ' 终端' : ' terminal')),
              line(zh ? 'Profile: ' + profileName : 'Profile: ' + profileName),
              line(zh ? 'Profile directory: ' + profileDir : 'Profile directory: ' + profileDir),
              line(zh ? 'Harness home: ' + home : 'Harness home: ' + home),
              line(zh ? '命令（不带 --profile 即操作当前 ' + profileName + ' profile）：' : 'Commands (without --profile, these act on the ' + profileName + ' profile):'),
              line('  dsh --dump-config'),
              line('  dsh plugin add <third-party-plugin>'),
              line('  dsh plugin remove <third-party-plugin>'),
              line('  dsh plugin update'),
              line(zh ? '安装/移除插件后请重启 DSH My Desktop。' : 'Restart DSH My Desktop after plugin changes.'),
              line(''),
              '',
            ].join('\r\n')
            welcomePath = join(stateDir, 'welcome.cmd')
            writeFileSync(welcomePath, welcome, 'utf8')
          } else {
            writeFileSync(join(shimDir, 'dsh'),
              '#!/usr/bin/env sh\nexec "' + node + '" "' + termQuoted + '" "$@"\n', 'utf8')
            try { spawn('chmod', ['+x', join(shimDir, 'dsh')], { stdio: 'ignore' }).unref() } catch { /* ignore */ }
          }
        } catch {
          shimDir = undefined // Fall through to a plain terminal if the shim cannot be written.
        }
      }

      // Windows exposes the search path as `Path` (case-insensitive); Node only
      // guarantees it under whichever casing the OS used. Read both and rebuild a
      // single entry so the original PATH is never dropped when we prepend.
      const originalPath = process.platform === 'win32'
        ? (process.env.Path ?? process.env.PATH ?? '')
        : (process.env.PATH ?? '')
      const pathVar = process.platform === 'win32' ? 'Path' : 'PATH'
      const separator = process.platform === 'win32' ? ';' : ':'
      // Prepend the shim dir AND the bundled node dir (so `dsh plugin`, which spawns
      // `pnpm` from PATH, finds the bundled pnpm.cmd) — the system/user PATH is never touched.
      const extraPath: string[] = []
      if (shimDir !== undefined) extraPath.push(shimDir)
      if (process.platform === 'win32') extraPath.push(nodeBinDir)
      const nextPath = extraPath.length === 0 ? originalPath : [...extraPath, originalPath].join(separator)
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        DSH_HOME: home,
        [pathVar]: nextPath,
      }
      if (process.platform === 'win32' && process.env.PATH !== undefined) delete env.PATH

      if (process.platform === 'win32') {
        // Opening a persistent interactive console from a Windows GUI (Electron)
        // main process must go through a `start` broker: a directly spawned
        // `cmd /K` console child does not stay attached/open (it exits instantly),
        // so we write a tiny broker that uses `start` to open the real interactive
        // window and then exits. This mirrors the reference desktop-terminal.
        const cmd = process.env.ComSpec ?? 'cmd.exe'
        const cmdQuoted = cmd.replace(/"/g, '""')
        const brokerDir = dirname(welcomePath ?? cwd)
        const target = welcomePath !== undefined
          ? cmdQuoted + ' /D /K call "' + welcomePath.replace(/"/g, '""') + '"'
          : cmdQuoted + ' /D /K cd /d "' + cwd.replace(/"/g, '""') + '"'
        const launchCmd = join(brokerDir, 'launch.cmd')
        const broker = [
          '@echo off',
          'start "' + DESKTOP_APP_NAME + '" /D "' + cwd.replace(/"/g, '""') + '" ' + target,
          'exit /b 0',
          '',
        ].join('\r\n')
        writeFileSync(launchCmd, broker, 'utf8')
        // Spawn the broker from its own directory using just the basename. Passing
        // the full quoted path to `cmd /S /C` fails (exit 1) when it contains spaces
        // (e.g. "...\DSH My Desktop\..."), so run `cmd /D /S /C launch.cmd` from the
        // broker dir — the same pattern the reference desktop-terminal uses. The
        // broker itself runs hidden; its `start` creates the visible console.
        const child = spawn(cmd, ['/D', '/S', '/C', 'launch.cmd'], {
          cwd: brokerDir,
          env,
          stdio: 'ignore',
          detached: false,
          windowsHide: true,
        })
        child.once('error', error => { logTerminalError('spawn failed: ' + (error instanceof Error ? error.message : String(error))) })
        child.unref()
        return
      }
      const loginShell = process.env.SHELL ?? '/bin/bash'
      const child = spawn(loginShell, ['-l'], { cwd, env, stdio: 'ignore', detached: true })
      child.once('error', error => { logTerminalError('spawn failed: ' + (error instanceof Error ? error.message : String(error))) })
      child.unref()
    } catch (error) {
      // Opening a terminal is best-effort; never take down the host on failure.
      logTerminalError('open failed: ' + (error instanceof Error ? error.stack ?? error.message : String(error)))
    }
  }

  return { openDshTerminal, logTerminalError }
}

export type TerminalService = ReturnType<typeof createTerminalService>
