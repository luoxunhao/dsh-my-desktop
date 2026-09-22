/** 桌面端随包 npm 目录。全部写入用户 profile，便于官方包和社区包在线升级。 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface BundledPlugin {
  packageName: string
  version: string
  /**
   * Repo-relative path of a PREBUILT tarball to install instead of a registry version.
   *
   * For first-party plugins that are not published (or whose published line is too
   * old for this runtime): the built artifact is committed under `vendor/`, and both
   * `prepare-runtime` (staging it into the offline store) and the seed step (the
   * `file:` spec) read it from there. Nothing is built from source in this repo.
   *
   * The artifact must be self-describing and self-contained — `lib/` + a manifest
   * whose `files`/`exports` resolve inside the tarball — because installing it runs
   * no build step.
   */
  vendorTarball?: string
}

/** 官方 DSH 家族统一锁死的版本。打包和在线升级都按这一个号对齐。 */
export const OFFICIAL_DSH_VERSION = '0.1.7-alpha.1'

/** 官方 DSH 运行时。从 npm 安装，不依赖本地 deepseek-harness 源码。 */
export const OFFICIAL_RUNTIME: BundledPlugin = {
  packageName: '@deepseek-ai/dsh',
  version: OFFICIAL_DSH_VERSION,
}

/** 官方运行时启动必需、但 DSH 只声明为 peer 的包。auto-install-peers=false 时不会自动装上。 */
export const OFFICIAL_LAUNCH_PEERS: readonly BundledPlugin[] = [
  { packageName: '@deepseek-ai/cordis-plugin-group', version: '1.0.2' },
  { packageName: '@deepseek-ai/dsh-scope', version: OFFICIAL_DSH_VERSION },
  { packageName: '@deepseek-ai/dsh-timeout', version: OFFICIAL_DSH_VERSION },
  { packageName: '@deepseek-ai/dsh-invariants', version: OFFICIAL_DSH_VERSION },
]

export const OFFICIAL_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] as const

/**
 * 随包运行时额外携带的实验性官方浏览器能力包。
 *
 * 它们**不**进 `BUNDLED_PLUGINS`：那两个包都是 `@deepseek-ai/dsh-*` 官方作用域，
 * 而 `reconcileProfileBundles` 对官方作用域包直接 `continue`（见 plugin-seed.ts），
 * 于是它们永远进不了 profile 的 `dsh.profile.bundles`。装进 profile 又不在 bundles 里
 * = 启动插件对账眼中"没声明却躺在磁盘上"的多余包，实测会在下一次启动被摘掉。
 * 放进随包运行时目录则完全绕开这条路径：profile 对账不管理运行时目录。
 *
 * 随包 ≠ 启用：官方 provider 的设计是"仅在显式挂载后启用"，实际挂载由启动时生成的
 * browser-use overlay 负责（见 src/bridge/browser-use-overlay.ts）。该 overlay 必须用入口
 * 文件的 `file:` URL —— profile 的 patch 以 profile 目录为解析基准，裸包名解析不到这里。
 */
export const OFFICIAL_BROWSER_USE_PACKAGES: readonly BundledPlugin[] = [
  // 独占命名的 browserUse 服务槽位。
  { packageName: '@deepseek-ai/dsh-browser-use', version: OFFICIAL_DSH_VERSION },
  // Chromium 提供方：内部固定依赖 @playwright/mcp。
  { packageName: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp', version: OFFICIAL_DSH_VERSION },
]

/**
 * 随桌面端离线仓库分发的社区插件清单。**0.8.4 起为空：不再预装任何社区插件。**
 *
 * 清空的原因是这套机制把上游兼容性变成了发版阻塞，而不是因为它不工作：
 *
 * - 清单里每个插件都要按精确版本随包，而它们的 peer 普遍追不上官方家族的预发布号
 *   （`dsh-vision-router` 2.1.6/2.1.7 的 peer 上限是 `0.1.5-rc.2`，2.2.0 才刚加到
 *   `0.1.6-alpha.1`）⟹ 家族升版后它在渲染侧直接加载失败，而这只能靠真启动冒烟发现。
 * - store 的离线元数据按 registry 域名分键（`<store>/cache/v11/metadata/<host>/<包>.jsonl`），
 *   构建走镜像源、首启按默认源找 ⟹ 一次强制重装就能让离线补种全灭。
 *
 * 随包仍然只有官方运行时（含实验性 browser use，见 `OFFICIAL_BROWSER_USE_PACKAGES`）。
 * 用户要这些插件时在设置页自行安装即可 —— 装它们走的 `desktopPnpm` 桥不受影响。
 *
 * 下面的 `vendorTarball` 机制、`prepare-runtime` 的 store 装配与首启补种路径都保留：
 * 清单非空时它们照常工作（`STORE_PACKAGES.length === 0` 时整段跳过），重新启用只需往
 * 这个数组里加条目。
 */
export const BUNDLED_PLUGINS: readonly BundledPlugin[] = []

/** 离线 store 只放社区插件。 */
export const STORE_PACKAGES: readonly BundledPlugin[] = BUNDLED_PLUGINS

/** 首次补种的完整清单：官方运行时，加上清单非空时的离线社区插件。 */
export const SEEDED_PACKAGES: readonly BundledPlugin[] = [OFFICIAL_RUNTIME, ...BUNDLED_PLUGINS]

/**
 * Directory inside the offline store that holds vendored plugin tarballs.
 *
 * `prepare-runtime` copies the committed artifact here at build time, and the seed
 * step reads it back from the EXTRACTED store, so both sides must derive the same
 * relative location. Keep this the single definition — a second copy is exactly the
 * drift that would make seeding look in the wrong place.
 */
export const VENDOR_TARBALL_DIR_NAME = 'vendor-tarballs'

/** Absolute path of the vendored-tarball directory inside a given store root. */
export function vendorTarballDir(storeDir: string): string {
  return join(storeDir, VENDOR_TARBALL_DIR_NAME)
}

/** Filename a vendored plugin's tarball gets inside the store (pnpm's own scheme). */
export function vendorTarballName(plugin: BundledPlugin): string {
  const scope = plugin.packageName.startsWith('@')
    ? plugin.packageName.slice(1).replace('/', '-')
    : plugin.packageName
  return `${scope}-${plugin.version}.tgz`
}

/**
 * pnpm spec for a bundled plugin: a vendored artifact for first-party plugins, the
 * registry for community packages.
 *
 * Vendored plugins are not on npm at a compatible version, so `name@version` cannot
 * resolve. The seed must point pnpm at the tarball that shipped inside the store it
 * just extracted. A missing tarball is a BUILD defect, not a fallback: silently
 * returning a registry spec would send pnpm after a version that does not exist, so
 * the caller gets an error naming the expected path instead.
 *
 * `storeDir` is optional because most seed calls install the official runtime and
 * launch peers, which are always registry packages. A vendored plugin without a
 * storeDir cannot be resolved at all, so that combination is rejected rather than
 * quietly downgraded.
 */
export function bundledPluginSeedSpec(plugin: BundledPlugin, storeDir?: string): string {
  if (plugin.vendorTarball === undefined) return `${plugin.packageName}@${plugin.version}`
  if (storeDir === undefined) {
    throw new Error(`随包插件 ${plugin.packageName} 需要 store 目录才能定位随包产物，但调用方未提供 storeDir。`)
  }
  const expected = join(vendorTarballDir(storeDir), vendorTarballName(plugin))
  if (!existsSync(expected)) {
    throw new Error(
      `随包插件 ${plugin.packageName} 的产物缺失：${expected}。`
      + '该版本未发布 npm，无法回退到 registry；请重新出包（prepare-runtime 会重新拷入产物）。',
    )
  }
  return `file:${expected.replaceAll('\\', '/')}`
}

export function bundledPluginNames(): readonly string[] {
  return BUNDLED_PLUGINS.map(plugin => plugin.packageName)
}

export function seededPackageNames(): readonly string[] {
  return SEEDED_PACKAGES.map(plugin => plugin.packageName)
}

export function isOfficialDshPackage(packageName: string): boolean {
  return packageName === '@deepseek-ai/dsh' || packageName.startsWith('@deepseek-ai/dsh-')
}

export function isDeepSeekOfficialPackage(packageName: string): boolean {
  return packageName.startsWith('@deepseek-ai/')
}

export function officialDshVersionOverrides(version = OFFICIAL_DSH_VERSION): Record<string, string> {
  return {
    '@deepseek-ai/dsh': version,
    '@deepseek-ai/dsh-*': version,
  }
}

export function officialRuntimeDependencies(version = OFFICIAL_DSH_VERSION): Record<string, string> {
  return Object.fromEntries([
    [OFFICIAL_RUNTIME.packageName, version],
    ...OFFICIAL_LAUNCH_PEERS.map((plugin) => [
      plugin.packageName,
      plugin.packageName.startsWith('@deepseek-ai/dsh-') ? version : plugin.version,
    ]),
    // 浏览器能力包全部是 @deepseek-ai/dsh-* 官方作用域，一律跟家族版本号走。
    ...OFFICIAL_BROWSER_USE_PACKAGES.map((plugin) => [plugin.packageName, version] as [string, string]),
  ])
}

/** 按 SemVer 比较正式版和 alpha/beta/rc 预发布号。 */
export function compareReleaseVersions(left: string, right: string): number {
  const parse = (value: string): { major: number; minor: number; patch: number; prerelease?: string[] } | undefined => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
    if (match === null) return undefined
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
      ...(match[4] === undefined ? {} : { prerelease: match[4].split('.') }),
    }
  }
  const a = parse(left)
  const b = parse(right)
  if (a === undefined || b === undefined) return left.localeCompare(right)
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch
  if (core !== 0) return core
  if (a.prerelease === undefined) return b.prerelease === undefined ? 0 : 1
  if (b.prerelease === undefined) return -1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber
    if (leftNumber !== undefined) return -1
    if (rightNumber !== undefined) return 1
    return leftPart.localeCompare(rightPart)
  }
  return 0
}

export function planOfficialRuntimeTarget(input: {
  installed?: string
  aligned: boolean
  baked: string
  published?: string
  pending?: string
}): string | undefined {
  if (input.pending !== undefined && input.pending !== '') return input.pending
  const baseline = input.published !== undefined && compareReleaseVersions(input.published, input.baked) >= 0
    ? input.published
    : input.baked
  if (input.installed === undefined || input.installed === '') return baseline
  if (!input.aligned) return compareReleaseVersions(baseline, input.installed) >= 0 ? baseline : input.installed
  if (compareReleaseVersions(baseline, input.installed) > 0) return baseline
  return undefined
}

/** 官方 npm registry。可被 DSH_BUILD_REGISTRY 环境变量覆盖（例如指到 npmmirror 以提速/过墙）。 */
export const OFFICIAL_NPM_REGISTRY = 'https://registry.npmjs.org/'
export const BUILD_REGISTRY_ENV = 'DSH_BUILD_REGISTRY'

/** 解析打包所用的 npm registry：默认官方源，可用 DSH_BUILD_REGISTRY 覆盖。 */
export function buildRegistry(env: Record<string, string | undefined> = process.env): string {
  const configured = env[BUILD_REGISTRY_ENV]?.trim()
  return configured === undefined || configured === '' ? OFFICIAL_NPM_REGISTRY : configured
}

/** pnpm 11 默认拦截构建脚本；这些原生/prepare 依赖必须放行，否则装配会以 ERR_PNPM_IGNORED_BUILDS 失败。 */
export const ALLOWED_BUILD_PACKAGES = [
  '@deepseek-ai/dsh-subprocess-local',
  '@google/genai',
  'koffi',
  'node-pty',
  'protobufjs',
] as const

export function pnpmAllowBuildsManifest(): { onlyBuiltDependencies: string[]; allowBuilds: Record<string, true> } {
  return { onlyBuiltDependencies: [...ALLOWED_BUILD_PACKAGES], allowBuilds: Object.fromEntries(ALLOWED_BUILD_PACKAGES.map(name => [name, true])) }
}

export function officialRuntimePnpmConfig(version = OFFICIAL_DSH_VERSION): {
  onlyBuiltDependencies: string[]
  allowBuilds: Record<string, true>
  overrides: Record<string, string>
} {
  return { ...pnpmAllowBuildsManifest(), overrides: officialDshVersionOverrides(version) }
}

export function pnpmWorkspaceYaml(autoInstallPeers = true): string {
  const onlyBuilt = ALLOWED_BUILD_PACKAGES.map(name => `  - ${JSON.stringify(name)}`).join('\n')
  const allow = ALLOWED_BUILD_PACKAGES.map(name => `  ${JSON.stringify(name)}: true`).join('\n')
  return ['packages:', '  - .', '', 'nodeLinker: hoisted', 'autoInstallPeers: ' + (autoInstallPeers ? 'true' : 'false'), 'onlyBuiltDependencies:', onlyBuilt, 'allowBuilds:', allow, ''].join('\n')
}
