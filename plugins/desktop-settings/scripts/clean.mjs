// Remove build artifacts before a fresh build.
import { rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
for (const target of ['lib', 'dist']) {
  const path = join(root, target)
  if (existsSync(path)) await rm(path, { recursive: true, force: true })
}
console.log('cleaned lib/dist')
