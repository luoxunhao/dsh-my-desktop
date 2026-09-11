import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { renderTerminalEntry, rewriteProfileInvocation } from '../src/desktop/dsh-term.js'

test('bare `dsh` boots the active profile', () => {
  assert.deepEqual(rewriteProfileInvocation([], 'web'), ['--profile', 'web'])
  assert.deepEqual(rewriteProfileInvocation(['task'], 'web'), ['--profile', 'web', 'task'])
})

test('`dsh --dump-config` gets the injected profile for the dump', () => {
  assert.deepEqual(rewriteProfileInvocation(['--dump-config'], 'web'), ['--profile', 'web', '--dump-config'])
})

test('`dsh plugin …` places --profile on the plugin subcommand, not the parent', () => {
  assert.deepEqual(rewriteProfileInvocation(['plugin', 'list'], 'web'), ['plugin', '--profile', 'web', 'list'])
  assert.deepEqual(
    rewriteProfileInvocation(['plugin', 'add', 'some-pkg'], 'web'),
    ['plugin', '--profile', 'web', 'add', 'some-pkg'],
  )
  assert.deepEqual(
    rewriteProfileInvocation(['plugin', 'remove', '@scope/pkg'], 'web'),
    ['plugin', '--profile', 'web', 'remove', '@scope/pkg'],
  )
})

test('`web`, help, and version aliases are left untouched (their subcommands reject a parent profile)', () => {
  assert.deepEqual(rewriteProfileInvocation(['web'], 'web'), ['web'])
  assert.deepEqual(rewriteProfileInvocation(['web', '--port', '8080'], 'web'), ['web', '--port', '8080'])
  assert.deepEqual(rewriteProfileInvocation(['--help'], 'web'), ['--help'])
  assert.deepEqual(rewriteProfileInvocation(['-h'], 'web'), ['-h'])
  assert.deepEqual(rewriteProfileInvocation(['--version'], 'web'), ['--version'])
  assert.deepEqual(rewriteProfileInvocation(['-V'], 'web'), ['-V'])
})

test('an explicit --profile anywhere is respected and not rewritten', () => {
  assert.deepEqual(
    rewriteProfileInvocation(['--profile', 'other', 'plugin', 'list'], 'web'),
    ['--profile', 'other', 'plugin', 'list'],
  )
  assert.deepEqual(
    rewriteProfileInvocation(['plugin', '--profile', 'other', 'list'], 'web'),
    ['plugin', '--profile', 'other', 'list'],
  )
  assert.deepEqual(
    rewriteProfileInvocation(['--profile=other'], 'web'),
    ['--profile=other'],
  )
})

test('the rendered wrapper is self-contained ESM that embeds the profile and entry', () => {
  const source = renderTerminalEntry('web', 'C:\\app\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js')
  // The entry import must chain into an explicit runCli() call — importing alone
  // leaves the 0.1.5 `import.meta.main` guard false and the CLI never runs.
  assert.match(source, /const mod = await import\(pathToFileURL\(entry\)\.href\)/)
  assert.match(source, /if \(typeof mod\.runCli === 'function'\) await mod\.runCli\(\)/)
  assert.match(source, /const profileName = "web"/)
  // The entry path is JSON-stringified so backslashes survive.
  assert.match(source, /const entry = "C:\\\\app\\\\node_modules/)
  // It must not import the official CLI at write time — only by dynamic import later.
  assert.match(source, /userArgs\[0\] === 'plugin'/)
})

test('rendered wrapper has no top-level await import of repo code (runs standalone under bundled node)', () => {
  const source = renderTerminalEntry('web', '/opt/runtime/lib/bin.js')
  const importLines = source.split('\n').filter(line => /^\s*import\b/.test(line))
  // Only the built-in node:url import; the official entry is dynamic-imported.
  assert.deepEqual(importLines, ["import { pathToFileURL } from 'node:url'"])
})

/**
 * THE BUG THIS GUARDS (seen live on 0.1.5-rc.1)
 * --------------------------------------------
 * The official CLI guards itself with `if (import.meta.main) await runCli()`.
 * When the wrapper imports the entry as a MODULE, `import.meta.main` is false
 * (the main module is the wrapper), so runCli never ran — `dsh --version`
 * exited 0 with ZERO output, no error, silently. The CLI exports `runCli`
 * precisely for embedded launches, so the wrapper must call it after import
 * and fall back to the import-time self-start of 0.1.2-era entries.
 *
 * The seam: render the wrapper, write it next to a FIXTURE entry carrying the
 * same guard + export, execute it with real node, and require the CLI effect.
 * A source-only assertion cannot catch this — the failure is in module
 * identity, not syntax.
 */
test('the rendered wrapper actually runs the CLI when the entry guards with import.meta.main', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-term-exec-'))
  try {
    // Fixture entry mirrors @deepseek-ai/dsh 0.1.5: main-guard + runCli export.
    // It prints a marker to prove runCli executed (and its argv contract).
    const entry = join(dir, 'bin.js')
    writeFileSync(entry, [
      'export async function runCli() {',
      '  const args = process.argv.slice(2)',
      '  console.log("RAN-CLI " + (args[0] ?? "") + " profile=" + (args[1] ?? ""))',
      '}',
      'if (import.meta.main) await runCli()',
      '',
    ].join('\n'), 'utf8')
    const wrapperPath = join(dir, 'dsh-term.mjs')
    writeFileSync(wrapperPath, renderTerminalEntry('web', entry), 'utf8')
    const node = process.execPath
    const stdout = await new Promise<string>((resolvePromise, rejectPromise) => {
      const child = spawn(node, [wrapperPath, '--dump-config'], { stdio: ['ignore', 'pipe', 'inherit'] })
      let out = ''
      child.stdout.on('data', chunk => { out += String(chunk) })
      child.once('error', rejectPromise)
      child.once('close', code => {
        if (code === 0) resolvePromise(out)
        else rejectPromise(new Error('wrapper exited ' + code))
      })
    })
    // Without the explicit runCli() call the guard is false under import() and
    // this prints nothing — the exact silent-exit the user saw in the terminal.
    // Bare `dsh --dump-config` also proves the profile rewrite: argv becomes
    // ['--profile', 'web', '--dump-config'] before the CLI sees it.
    assert.match(stdout, /RAN-CLI --profile profile=web/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
