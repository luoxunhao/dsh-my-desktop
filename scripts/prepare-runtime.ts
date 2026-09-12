import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ALLOWED_BUILD_PACKAGES, buildRegistry, officialRuntimeDependencies, officialRuntimePnpmConfig, pnpmWorkspaceYaml, STORE_PACKAGES, vendorTarballDir, vendorTarballName, type BundledPlugin } from '../src/runtime/bundled-plugins.js'
import { extractTarGz, packDirectoryToTarGz, verifyFileSha256, writeFileSha256 } from '../src/infra/runtime-archive.js'

const projectRoot = resolve(import.meta.dirname, '..', '..')
const nodeRoot = join(projectRoot, 'runtime-node')
const pluginRoot = join(projectRoot, 'runtime-plugins')
const officialRuntimeRoot = join(projectRoot, 'runtime-dsh')
const bundledPnpmVersion = '11.24.0'

export async function removePreparedPath(target: string): Promise<void> {
  if (!existsSync(target)) return
  try {
    await rm(target, { force: true, maxRetries: 10, recursive: true, retryDelay: 200 })
  } catch (error) {
    if (process.platform !== 'win32' || !isRetryableRemoveError(error)) throw error
    spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `rmdir /s /q "${target}"`], { stdio: 'ignore', windowsHide: true })
    spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `del /f /q "${target}"`], { stdio: 'ignore', windowsHide: true })
    if (existsSync(target)) throw error
  }
}

function isRetryableRemoveError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOTEMPTY' || code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
}

export function resolveBundledNodeSha256(checksums: unknown, platform = process.platform, architecture = process.arch): string {
  if (typeof checksums !== 'object' || checksums === null || Array.isArray(checksums)) {
    throw new Error('package.json 缺少随包 Node SHA256 配置。')
  }
  const target = `${platform}-${architecture}`
  const checksum = (checksums as Record<string, unknown>)[target]
  if (typeof checksum !== 'string') throw new Error(`缺少随包 Node SHA256：${target}。`)
  return checksum
}

async function main(): Promise<void> {
  const projectManifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as {
    config?: { bundledNodeSha256?: unknown, bundledNodeVersion?: unknown }
  }
  const expectedNodeVersion = projectManifest.config?.bundledNodeVersion
  const expectedNodeSha256 = resolveBundledNodeSha256(projectManifest.config?.bundledNodeSha256)

  if (typeof expectedNodeVersion !== 'string') throw new Error('package.json 缺少随包 Node 版本配置。')
  if (process.version !== expectedNodeVersion) {
    throw new Error('随包 Node 版本不匹配：需要 ' + expectedNodeVersion + '，实际 ' + process.version + '。')
  }
  const officialArchive = join(projectRoot, 'runtime-dsh.tgz')
  // 缓存优先：官方运行时一旦装配过且与目标版本一致，就复用本地产物，不再联网
  // 重下整套官方 DSH。仅当 DSH_FORCE_RUNTIME_REBUILD=1（升版本/配置变更）时强制重装。
  const forceRuntime = String(process.env.DSH_FORCE_RUNTIME_REBUILD) === '1'
  const runtimeCurrent = !forceRuntime
    && existsSync(officialArchive)
    && officialRuntimeIsCurrent(officialRuntimeRoot)

  // Node / pnpm 装配是本地拷贝（廉价），始终执行；但不清运行时目录以免误删可复用缓存。
  const targetsToWipe = [nodeRoot, pluginRoot, ...(runtimeCurrent ? [] : [officialRuntimeRoot, officialArchive])]
  for (const target of targetsToWipe) {
    if (!target.startsWith(projectRoot + sep)) throw new Error(`拒绝清理项目外路径：${target}`)
    await removePreparedPath(target)
  }

  const nodeExecutable = process.execPath
  const nodeSha256 = createHash('sha256').update(await readFile(nodeExecutable)).digest('hex').toUpperCase()
  if (nodeSha256 !== expectedNodeSha256) throw new Error('随包 Node SHA256 不匹配：' + nodeSha256 + '。')
  await mkdir(nodeRoot, { recursive: true })
  const stagedNodeExecutable = join(nodeRoot, process.platform === 'win32' ? 'node.exe' : 'node')
  await cp(nodeExecutable, stagedNodeExecutable)
  await writeFile(`${stagedNodeExecutable}.sha256`, nodeSha256 + '\n', 'utf8')
  await stagePnpm(nodeRoot)
  if (runtimeCurrent) {
    console.log(`复用本地预装官方运行时：${officialRuntimeRoot}（版本一致，跳过联网装配）`)
  } else {
    const officialStore = join(officialRuntimeRoot, '.store')
    await stageOfficialRuntime(officialRuntimeRoot, nodeRoot, officialStore)
    await removePreparedPath(officialStore)
    packDirectoryToTarGz(officialRuntimeRoot, join(projectRoot, 'runtime-dsh.tgz'))
    writeFileSha256(join(projectRoot, 'runtime-dsh.tgz'))
  }
  console.log(`已装配 Node 运行时：${nodeRoot}`)
  console.log(`已装配预装官方运行时：${join(projectRoot, 'runtime-dsh.tgz')}`)
  if (STORE_PACKAGES.length > 0) await stagePluginStore()
  // 随包私有桌面设置插件：把 dsh-my-desktop-setting 的构建产物拷到打包资源。
  await stageDesktopSettingsPlugin()
}

/**
 * 装配并打包随包插件离线仓库（`runtime-plugins/store.tgz`）。
 *
 * 与官方运行时装配解耦：官方运行时可以复用本地产物（缓存优先），但插件仓库必须
 * **每次出包都重装**——随包插件清单变了而 store 没重建，安装包里就还是上一次的
 * 插件集合，而且是静默的。`--stage-plugin` 快速路径也走这里。
 */
export async function stagePluginStore(): Promise<void> {
  if (STORE_PACKAGES.length === 0) return
  await stageBundledPlugins(pluginRoot, nodeRoot)
  packDirectoryToTarGz(join(pluginRoot, 'store'), join(pluginRoot, 'store.tgz'))
  writeFileSha256(join(pluginRoot, 'store.tgz'))
  console.log(`已装配内置插件仓库：${join(pluginRoot, 'store.tgz')}`)
}

/**
 * 把随包私有桌面设置插件构建产物拷到 dist/desktop-settings-plugin（供 extraResources）。
 *
 * 插件与启动器是一体的：它是 DSH My Desktop 的定制设置页，缺了它安装包就没有桌面设置。
 * 因此构建产物缺失时**直接失败**，而不是警告后跳过——静默跳过会产出一个看起来正常、
 * 但设置页消失的安装包，比构建报错难查得多。
 */
export async function stageDesktopSettingsPlugin(): Promise<void> {
  const sourceEnv = process.env.DSH_DESKTOP_SETTINGS_DIR
  const source = sourceEnv !== undefined && sourceEnv !== ''
    ? resolve(sourceEnv)
    : join(projectRoot, 'plugins', 'dsh-my-desktop-settings')
  for (const file of ['lib/index.js', 'lib/client.js'] as const) {
    if (!existsSync(join(source, file))) {
      throw new Error(
        `随包桌面设置插件构建产物缺失：${join(source, file)}\n`
        + '  先构建插件（pnpm run build:plugin），或用 DSH_DESKTOP_SETTINGS_DIR 指向已构建的插件目录。',
      )
    }
  }
  const dest = join(projectRoot, 'dist', 'desktop-settings-plugin')
  await removePreparedPath(dest)
  await mkdir(join(dest, 'lib'), { recursive: true })
  await cp(join(source, 'lib', 'index.js'), join(dest, 'lib', 'index.js'))
  await cp(join(source, 'lib', 'client.js'), join(dest, 'lib', 'client.js'))
  // Ship the plugin manifest too: it carries the plugin's own version, which
  // `prepareDesktopSettings` reads when materializing the per-user copy.
  const manifest = join(source, 'package.json')
  if (existsSync(manifest)) await cp(manifest, join(dest, 'package.json'))
  await writeFile(join(dest, 'cordis.patch.yml'), '[]\n', 'utf8')
  console.log(`已装配随包桌面设置插件：${dest}`)
}

async function copyWorkspacePackage(sourcePackage: string, destinationPackage: string): Promise<void> {
  await removePreparedPath(destinationPackage)
  const nestedNodeModules = join(sourcePackage, 'node_modules')
  await cp(sourcePackage, destinationPackage, {
    dereference: false,
    filter: path => path !== nestedNodeModules && !path.startsWith(nestedNodeModules + sep),
    recursive: true,
  })
}

export async function copyWorkspacePackages(directory: string, depth: 1 | 2, destinationRoot: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const firstLevel = join(directory, entry.name)
    if (!(await isDirectory(entry, firstLevel))) continue
    const candidates = depth === 1
      ? [firstLevel]
      : await findDirectories(firstLevel)
    for (const candidate of candidates) {
      const manifestPath = join(candidate, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { name?: unknown }
      if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@deepseek-ai/')) continue
      await copyWorkspacePackage(await realpath(candidate), join(destinationRoot, 'node_modules', manifest.name))
    }
  }
}

export function resolvePnpmPackageRoot(entry = process.env.npm_execpath): string {
  if (entry === undefined || entry === '') throw new Error('未找到 pnpm 入口，必须通过 pnpm 执行运行时装配。')
  let current = resolve(entry)
  for (let index = 0; index < 8; index += 1) {
    const manifestPath = join(current, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }
      if (manifest.name === 'pnpm' || manifest.name === '@pnpm/exe') return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error('无法从当前 pnpm 入口定位 pnpm 包装目录。')
}

export async function stagePnpm(destinationRoot: string): Promise<void> {
  const packageRoot = await materializePnpmPackage(destinationRoot)
  const entry = resolvePnpmEntry(packageRoot)
  await writePnpmShims(destinationRoot, relative(packageRoot, entry).replaceAll('\\', '/'))
}

export async function writePnpmShims(destinationRoot: string, relativeEntry: string, platform = process.platform): Promise<void> {
  const nodeName = platform === 'win32' ? 'node.exe' : 'node'
  await writeFile(
    join(destinationRoot, 'pnpm.cmd'),
    `@echo off\r\n"%~dp0${nodeName}" "%~dp0pnpm-package\\${relativeEntry.replaceAll('/', '\\')}" %*\r\n`,
    'utf8',
  )
  if (platform === 'win32') return
  await writeFile(
    join(destinationRoot, 'pnpm'),
    `#!/bin/sh\nexec "$(dirname "$0")/${nodeName}" "$(dirname "$0")/pnpm-package/${relativeEntry}" "$@"\n`,
    'utf8',
  )
  chmodSync(join(destinationRoot, 'pnpm'), 0o755)
}
export async function stageBundledPlugins(destinationRoot: string, nodeRoot: string): Promise<void> {
  const storeDir = join(destinationRoot, 'store')
  const stagingDir = join(destinationRoot, 'staging')
  // Wipe stale staging first: an aborted previous run leaves its manifest behind,
  // and pnpm would then resolve THAT dependency set instead of the one this call
  // just computed.
  await removePreparedPath(stagingDir)
  // Same reason for the vendored-tarball dir: a version bump must not leave the
  // previous artifact next to the new one, or seeding could install a build nobody
  // shipped. prepare-runtime is the only writer, so clearing it is safe.
  await removePreparedPath(vendorTarballDir(storeDir))
  // Reclaim the retired `local-tarballs/` dir from an older build: nothing writes it
  // any more, so without this it lingers in store.tgz as dead weight (and as a
  // second, unverified copy of an artifact that now has exactly one home).
  await removePreparedPath(join(storeDir, 'local-tarballs'))
  await mkdir(stagingDir, { recursive: true })
  // Registry plugins keep their BARE version as the dependency value: a
  // `name@version` string in that position is parsed as an npm ALIAS
  // (`alias@npm:real`), which fails with SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER.
  // Vendored plugins point at their committed artifact instead — it is not on npm
  // at a compatible version, so a registry spec would 404.
  const stagedPackages = await Promise.all(STORE_PACKAGES.map(async (plugin) =>
    plugin.vendorTarball === undefined
      ? { ...plugin, spec: plugin.version }
      : { ...plugin, spec: `file:${await stageVendorTarball(plugin, storeDir)}` }))
  await writeFile(join(stagingDir, 'package.json'), JSON.stringify({
    name: 'dsh-desktop-bundled-plugins',
    private: true,
    dependencies: Object.fromEntries(stagedPackages.map(plugin => [plugin.packageName, plugin.spec])),
  }, undefined, 2) + '\n', 'utf8')
  await writeFile(join(stagingDir, 'pnpm-workspace.yaml'), pnpmWorkspaceYaml(false), 'utf8')
  runStagedPnpm(nodeRoot, [
    'install',
    '--dir', stagingDir,
    '--store-dir', storeDir,
    '--cache-dir', join(storeDir, 'cache'),
    '--prod',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=false',
    '--config.minimumReleaseAge=0',
    '--network-concurrency=1',
    '--fetch-retries=5',
    '--fetch-retry-mintimeout=10000',
    '--fetch-retry-maxtimeout=60000',
    '--registry=' + buildRegistry(),
  ])
  for (const plugin of stagedPackages) {
    if (!existsSync(join(stagingDir, 'node_modules', ...plugin.packageName.split('/'), 'package.json'))) {
      throw new Error(`内置插件装配后缺失：${plugin.packageName}`)
    }
  }
  await pruneStoreForPackaging(storeDir)
  await removePreparedPath(stagingDir)
}

/**
 * Copy a plugin's committed prebuilt tarball into the offline store.
 *
 * The artifact is shipped as-is: it already contains the built `lib/` and declares
 * no `prepare`/`postinstall`, so installing it runs no build step. We only verify
 * it is the artifact we think it is (checksum + declared identity/version) and put
 * it where the seed step will look for it.
 *
 * Verifying rather than trusting matters because this file is a binary blob in git:
 * a hand-swapped tarball would otherwise ship silently, and the mismatch would only
 * surface as odd runtime behaviour on a user's machine.
 *
 * Returns the destination path (inside the store) so the caller can build a `file:`
 * spec that stays valid after the store is extracted to a per-user directory.
 */
export async function stageVendorTarball(plugin: BundledPlugin, storeDir: string): Promise<string> {
  const relative = plugin.vendorTarball
  if (relative === undefined) throw new Error(`${plugin.packageName} 没有随包产物路径。`)
  const source = resolve(projectRoot, relative)
  if (!source.startsWith(projectRoot + sep)) throw new Error(`拒绝读取项目外的随包产物：${source}`)
  if (!existsSync(source)) {
    throw new Error(
      `随包插件产物缺失：${source}\n`
      + `  该插件 ${plugin.version} 未发布 npm，必须把构建好的 tarball 提交到 ${relative}。`,
    )
  }
  // Checksum first: it is the one check that catches a corrupted/partial copy.
  verifyFileSha256(source)
  validateVendorTarballManifest(source, plugin)
  const destination = join(vendorTarballDir(storeDir), vendorTarballName(plugin))
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination)
  console.log(`已装配随包插件产物：${destination}`)
  return destination
}

/**
 * Assert the tarball really is the declared package at the declared version.
 *
 * Reading the manifest out of the archive (rather than trusting the filename) keeps
 * `bundled-plugins.ts` honest: a version bump on one side only fails the build here
 * instead of producing an installer that seeds a plugin older than it claims.
 */
export function validateVendorTarballManifest(tarball: string, plugin: BundledPlugin): void {
  const listed = spawnSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8', windowsHide: true })
  if (listed.status !== 0) throw new Error(`无法读取随包产物清单：${tarball}（${(listed.stderr || '').trim()}）`)
  let manifest: { name?: unknown, version?: unknown }
  try {
    manifest = JSON.parse(listed.stdout) as typeof manifest
  } catch {
    throw new Error(`随包产物清单不是合法 JSON：${tarball}`)
  }
  if (manifest.name !== plugin.packageName) {
    throw new Error(`随包产物身份不匹配：${tarball} 声明 ${String(manifest.name)}，期望 ${plugin.packageName}。`)
  }
  if (manifest.version !== plugin.version) {
    throw new Error(
      `随包产物版本不匹配：${tarball} 是 ${String(manifest.version)}，`
      + `bundled-plugins.ts 声明 ${plugin.version}。请重新构建产物或同步版本号。`,
    )
  }
}

/** 预装完整官方运行时，首启只需复制，避免现场 pnpm add。 */
export async function stageOfficialRuntime(destinationRoot: string, nodeRoot: string, storeDir: string): Promise<void> {
  if (!destinationRoot.startsWith(projectRoot + sep)) throw new Error(`拒绝写入项目外路径：${destinationRoot}`)
  await removePreparedPath(destinationRoot)
  await mkdir(destinationRoot, { recursive: true })
  await writeFile(join(destinationRoot, 'package.json'), JSON.stringify({
    name: 'dsh-desktop-runtime',
    private: true,
    pnpm: officialRuntimePnpmConfig(),
    dependencies: officialRuntimeNpmDependencies(),
  }, undefined, 2) + '\n', 'utf8')
  await writeFile(join(destinationRoot, 'pnpm-workspace.yaml'), pnpmWorkspaceYaml(), 'utf8')
  runCurrentNpm(officialRuntimeNpmInstallArgs(destinationRoot))
  const installedNodeModules = officialRuntimeGlobalNodeModulesRoot(destinationRoot)
  const runtimeNodeModules = join(destinationRoot, 'node_modules')
  if (installedNodeModules !== runtimeNodeModules) {
    await cp(installedNodeModules, runtimeNodeModules, { dereference: true, recursive: true })
    await removePreparedPath(join(destinationRoot, 'lib'))
  }
  const entry = join(destinationRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!existsSync(entry)) throw new Error('预装官方运行时后仍未找到入口。')
  validateOfficialRuntimeLayout(destinationRoot)
}

/** 官方预发布包存在 pnpm 无法解析的 peer 范围，运行时打包统一改用 npm。 */
export function officialRuntimeNpmDependencies(): Record<string, string> {
  return officialRuntimeDependencies()
}

export function officialRuntimeNpmInstallArgs(destinationRoot: string): string[] {
  return [
    'install',
    '--global',
    '--prefix=' + destinationRoot,
    '--omit=dev',
    '--package-lock=false',
    '--no-audit',
    '--no-fund',
    '--allow-scripts=' + ALLOWED_BUILD_PACKAGES.join(','),
    '--registry=' + buildRegistry(),
    ...Object.entries(officialRuntimeNpmDependencies()).map(([packageName, version]) => `${packageName}@${version}`),
  ]
}

/** 打包产物必须把启动 peer 放在运行时顶层，避免离线首启再回退到 npm。 */
export function validateOfficialRuntimeLayout(destinationRoot: string): void {
  for (const [packageName, expectedVersion] of Object.entries(officialRuntimeNpmDependencies())) {
    const manifestPath = join(destinationRoot, 'node_modules', ...packageName.split('/'), 'package.json')
    if (!existsSync(manifestPath)) throw new Error(`预装官方运行时缺少顶层依赖：${packageName}`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
    if (manifest.version !== expectedVersion) {
      throw new Error(`预装官方运行时依赖版本不匹配：${packageName}，需要 ${expectedVersion}，实际 ${String(manifest.version ?? '未知')}`)
    }
  }
}

/**
 * 判断本地已装配的官方运行时是否与目标依赖版本一致（不联网）。
 * 一致则复用本地产物，跳过官方 DSH 的整树联网重装。
 */
export function officialRuntimeIsCurrent(destinationRoot: string): boolean {
  for (const [packageName, expectedVersion] of Object.entries(officialRuntimeNpmDependencies())) {
    const manifestPath = join(destinationRoot, 'node_modules', ...packageName.split('/'), 'package.json')
    if (!existsSync(manifestPath)) return false
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
      if (manifest.version !== expectedVersion) return false
    } catch {
      return false
    }
  }
  return true
}

/** npm 全局安装在 Unix 位于 lib/node_modules，Windows 则直接位于 node_modules。 */
export function officialRuntimeGlobalNodeModulesRoot(destinationRoot: string, platform = process.platform): string {
  return platform === 'win32'
    ? join(destinationRoot, 'node_modules')
    : join(destinationRoot, 'lib', 'node_modules')
}

export async function pruneStoreForPackaging(storeDir: string): Promise<void> {
  const projects = join(storeDir, 'v11', 'projects')
  if (existsSync(projects)) await removePreparedPath(projects)
}

async function materializePnpmPackage(destinationRoot: string): Promise<string> {
  const destination = join(destinationRoot, 'pnpm-package')
  await mkdir(destination, { recursive: true })
  try {
    await cp(resolvePnpmPackageRoot(), destination, { dereference: true, recursive: true })
    const copiedManifest = JSON.parse(await readFile(join(destination, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
    if (!['pnpm', '@pnpm/exe'].includes(String(copiedManifest.name)) || copiedManifest.version !== bundledPnpmVersion) {
      throw new Error('当前 pnpm 与随包版本不一致。')
    }
    resolvePnpmEntry(destination)
    return destination
  } catch {
    const packDir = join(destinationRoot, '.pnpm-pack')
    await mkdir(packDir, { recursive: true })
    const packed = runCurrentPnpm(['pack', `pnpm@${bundledPnpmVersion}`, '--pack-destination', packDir])
    const archive = packed.stdout.split(/\r?\n/).map(line => line.trim()).find(line => line.endsWith('.tgz'))
    if (archive === undefined) throw new Error('下载随包 pnpm 失败。')
    extractTarGz(join(packDir, archive), packDir)
    const packedManifest = JSON.parse(await readFile(join(packDir, 'package', 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
    if (packedManifest.name !== 'pnpm' || packedManifest.version !== bundledPnpmVersion) {
      throw new Error('下载的 pnpm 包身份或版本不匹配。')
    }
    await removePreparedPath(destination)
    await cp(join(packDir, 'package'), destination, { dereference: true, recursive: true })
    await removePreparedPath(packDir)
    return destination
  }
}

function resolvePnpmEntry(packageRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> }
  const declared = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pnpm
  const candidates = [declared, 'bin/pnpm.cjs', 'dist/pnpm.cjs', 'bin/pnpm.js'].filter((item): item is string => Boolean(item))
  for (const candidate of candidates) {
    const entry = join(packageRoot, candidate)
    if (existsSync(entry)) return entry
  }
  throw new Error(`随包 pnpm 入口不存在：${packageRoot}`)
}

function runStagedPnpm(nodeRoot: string, args: readonly string[]): void {
  const nodeExecutable = join(nodeRoot, process.platform === 'win32' ? 'node.exe' : 'node')
  const result = spawnSync(nodeExecutable, [resolvePnpmEntry(join(nodeRoot, 'pnpm-package')), ...args], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`随包 pnpm 执行失败（退出码 ${result.status ?? '未知'}）。`)
}

function runCurrentNpm(args: readonly string[]): void {
  const entry = [
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(dirname(process.execPath)), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find(path => existsSync(path))
  if (entry === undefined) throw new Error('未找到当前 Node 附带的 npm CLI。')
  const result = spawnSync(process.execPath, [entry, ...args], { stdio: 'inherit', windowsHide: true })
  if (result.status !== 0) throw new Error(`npm ${args[0]} 失败（退出码 ${result.status ?? '未知'}）。`)
}

function runCurrentPnpm(args: readonly string[]): { stdout: string } {
  const pnpmEntry = process.env.npm_execpath
  if (!pnpmEntry) throw new Error('未找到 pnpm 入口，必须通过 pnpm 执行运行时装配。')
  const result = spawnSync(process.execPath, [pnpmEntry, ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`pnpm ${args[0]} 失败（退出码 ${result.status ?? '未知'}）。`)
  return { stdout: result.stdout ?? '' }
}

async function findDirectories(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const directories: string[] = []
  for (const entry of entries) {
    const candidate = join(directory, entry.name)
    if (await isDirectory(entry, candidate)) directories.push(candidate)
  }
  return directories
}

async function isDirectory(entry: { isDirectory(): boolean, isSymbolicLink(): boolean }, path: string): Promise<boolean> {
  return entry.isDirectory() || (entry.isSymbolicLink() && (await stat(path)).isDirectory())
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // `--stage-plugin`：快速出包路径（dist:local / pack:local）——不重装官方运行时，
  // 但仍必须装配**随包插件仓库**：store 里没有插件就等于没预装。
  if (process.argv.includes('--stage-plugin')) {
    await stageDesktopSettingsPlugin()
    await stagePluginStore()
  } else {
    await main()
  }
}


