/** 桌面端随包 npm 目录。全部写入用户 profile，便于官方包和社区包在线升级。 */

export interface BundledPlugin {
  packageName: string
  version: string
}

/** 官方 DSH 家族统一锁死的版本。打包和在线升级都按这一个号对齐。 */
export const OFFICIAL_DSH_VERSION = '0.1.5-rc.1'
export const APPLY_PLUGIN_UPDATES_IPC = 'apply-plugin-updates'

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
 * 随桌面端离线仓库分发的社区插件清单。
 *
 * 纯 DSH 启动器（0.1.0）：恒为空——安装包只随 DSH 官方核心运行时，不随任何社区插件。
 */
export const BUNDLED_PLUGINS: readonly BundledPlugin[] = []

/** 离线 store 只放社区插件；纯 DSH 启动器不装配 store。 */
export const STORE_PACKAGES: readonly BundledPlugin[] = BUNDLED_PLUGINS

/**
 * 随桌面端**从 npm registry 在线预装**的社区插件。
 *
 * 与 `BUNDLED_PLUGINS`（离线 store 目录，装进安装包）是两条不同的路：
 *
 *   - `BUNDLED_PLUGINS` → `STORE_PACKAGES` → prepare-runtime 装配 `store.tgz` 打进包；
 *   - `NPM_PREINSTALLED_PLUGINS` → 不进安装包、不装配 store，首启 / 新建或切换
 *     profile 时由随包 pnpm 从 registry 拉取，写进 profile 的 dependencies 并激活为 bundle。
 *
 * 因此这里**不参与离线 store 的 `storeExists` 门控**：没有离线仓库也必须安装。
 * 版本同样固定，安装后由插件自身 / 插件市场负责在线升级。
 */
export const NPM_PREINSTALLED_PLUGINS: readonly BundledPlugin[] = [
  // 可视化插件市场（npm 包名 dshmarket；源码参考 plugins/dsh-market/）。
  { packageName: 'dshmarket', version: '1.45.1' },
]

/** 首次补种的完整清单：官方运行时 +（无离线）社区插件。 */
export const SEEDED_PACKAGES: readonly BundledPlugin[] = [OFFICIAL_RUNTIME, ...BUNDLED_PLUGINS]

export function bundledPluginNames(): readonly string[] {
  return BUNDLED_PLUGINS.map(plugin => plugin.packageName)
}

export function seededPackageNames(): readonly string[] {
  return SEEDED_PACKAGES.map(plugin => plugin.packageName)
}

/** 从 npm 在线预装的社区插件包名（不含离线 store 清单）。 */
export function npmPreinstalledNames(): readonly string[] {
  return NPM_PREINSTALLED_PLUGINS.map(plugin => plugin.packageName)
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
