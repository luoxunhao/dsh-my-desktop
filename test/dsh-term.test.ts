import assert from 'node:assert/strict'
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
  assert.match(source, /await import\(pathToFileURL\(entry\)\.href\)/)
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
