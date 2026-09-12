/**
 * Recovery-page copy, ported from dsh-desktop's `recovery-copy.ts`.
 *
 * WHY A TABLE RATHER THAN INLINE STRINGS
 * --------------------------------------
 * The reference keeps every user-facing string in one typed record, and the page
 * renders `copy.<field>`. That buys three things a 1:1 replica needs:
 *
 *   1. The wording can be diffed against the reference at a glance — this file IS
 *      the parity checklist.
 *   2. Chinese and English stay structurally identical, so a missing translation is
 *      a type error rather than a silent English string in a Chinese page.
 *   3. Tab/panel titles are reused as guide-card headings, so a rename cannot make
 *      the quick-recovery navigation disagree with the tab bar.
 *
 * Kept deliberately close to the reference (same field names) so the two files stay
 * comparable.
 */

/** The recovery page's panels, in tab order. */
export type RecoveryTab = 'quick' | 'plugins' | 'rollback' | 'profiles' | 'data' | 'diagnostics'

/** Which startup phase failed. Mirrors the reference's stage vocabulary. */
export type StartupFailureStage =
  | 'electron-ready'
  | 'shell-environment'
  | 'runtime-bootstrap'
  | 'profile-selection'
  | 'profile-composition'
  | 'host-boot'
  | 'renderer-startup'
  | 'health-commit'

export interface RecoveryCopy {
  readonly title: string
  readonly fallbackBody: string
  readonly reason: string
  readonly requestedMode: string
  readonly requestedBody: string
  readonly currentProfile: string
  readonly currentProfileDirectory: string
  readonly failureStage: string
  readonly stageLabels: Readonly<Record<StartupFailureStage, string>>
  readonly tabs: Readonly<Record<RecoveryTab, string>>
  readonly quickRecovery: string
  readonly quickRecoveryBody: string
  readonly pluginGuideBody: string
  readonly rollbackGuideBody: string
  readonly profileSwitchGuideBody: string
  readonly dataGuideBody: string
  readonly diagnosticsGuideBody: string
  readonly safeMode: string
  readonly safeModeBody: string
  readonly safeModeActiveBody: string
  readonly safeModeUnavailable: string
  readonly enterSafeMode: string
  readonly checkpoints: string
  readonly checkpointsUnavailable: string
  readonly rollbackBody: string
  readonly noHealthyStartup: string
  readonly availableSlot: string
  readonly emptySlot: string
  readonly openCheckpoint: string
  readonly rollbackCheckpoint: string
  readonly desktopVersion: string
  readonly pluginCount: string
  readonly configurationFileCount: string
  readonly checkpointSize: string
  readonly unknown: string
  readonly plugins: string
  readonly pluginsBody: string
  readonly pluginsUnavailable: string
  readonly pluginsEmpty: string
  readonly core: string
  readonly profileDependency: string
  readonly external: string
  readonly isolatedPlugins: string
  readonly isolatedPluginsBody: string
  readonly isolatedPluginsEmpty: string
  readonly disabled: string
  readonly uninstall: string
  readonly restore: string
  readonly keepIsolated: string
  readonly diagnostics: string
  readonly savingDiagnostics: string
  readonly diagnosticsSaved: string
  readonly diagnosticsFailed: string
  readonly saveDiagnostics: string
  readonly showDiagnostics: string
  readonly privacy: string
  readonly configurationFiles: string
  readonly configurationFilesBody: string
  readonly openSettingsDocument: string
  readonly openProfilePatch: string
  readonly openProfileManifest: string
  readonly openProfileDirectory: string
  readonly startupLog: string
  readonly startupLogBody: string
  readonly startupLogEmpty: string
  readonly profiles: string
  readonly profilesBody: string
  readonly profilesUnavailable: string
  readonly profilesEmpty: string
  readonly switchProfile: string
  readonly addProfile: string
  readonly resetAndDataManagement: string
  readonly dataManagement: string
  readonly dataManagementBody: string
  readonly currentDataDirectory: string
  readonly changeDataDirectory: string
  readonly restoreDefaultDataDirectory: string
  readonly dataDirectoryUnavailable: string
  readonly dataDirectoryPath: string
  readonly dataDirectoryPlaceholder: string
  readonly selectDataDirectory: string
  readonly browse: string
  readonly applyDataDirectory: string
  readonly cancelDataDirectoryChange: string
  readonly factoryReset: string
  readonly factoryResetBody: string
  readonly factoryResetAction: string
  readonly restart: string
  readonly quit: string
  readonly working: string
  readonly back: string
  readonly cancel: string
}

const ZH: RecoveryCopy = {
  title: 'DSH My Desktop 恢复助手',
  fallbackBody: '无法读取恢复信息。请退出并重新启动 DSH My Desktop。',
  reason: '进入恢复模式的原因',
  requestedMode: '从重启菜单主动进入',
  requestedBody: '普通启动已暂停，当前 Profile 和插件 Host 尚未加载。',
  currentProfile: '当前 Profile',
  currentProfileDirectory: 'Profile 目录',
  failureStage: '失败阶段',
  stageLabels: {
    'electron-ready': 'Electron 初始化',
    'shell-environment': 'Shell 环境准备',
    'runtime-bootstrap': '桌面运行时准备',
    'profile-selection': 'Profile 选择',
    'profile-composition': '插件配置组合',
    'host-boot': '插件 Host 启动',
    'renderer-startup': '桌面界面启动',
    'health-commit': '启动健康状态确认',
  },
  tabs: {
    quick: '快速恢复',
    plugins: '插件管理',
    rollback: '回滚',
    profiles: '切换 Profile',
    data: '重置与数据管理',
    diagnostics: '诊断',
  },
  quickRecovery: '快速恢复',
  quickRecoveryBody: '建议先进入安全模式，再按照上方导航从左到右逐步处理。下面会说明每一步适合解决的问题；完成修改后需要重启才能生效。',
  pluginGuideBody: '如果问题在安全模式中消失，可以进入“插件管理”，从当前 Profile 尝试卸载最可能引发异常的插件。',
  rollbackGuideBody: '如果仅卸载插件仍无法恢复，请选择故障发生前的健康启动 Checkpoint 进行回滚。',
  profileSwitchGuideBody: '切换到其他或新建 Profile，可以先恢复桌面端的正常使用，同时保留当前 Profile 供后续排查。',
  dataGuideBody: '可以更改用于加载数据的文件夹；只有前面的恢复方式都无效时，才建议执行恢复出厂设置。',
  diagnosticsGuideBody: '需要进一步排查或寻求帮助时，可导出本地诊断包，并查看当前配置文件。',
  safeMode: '安全模式',
  safeModeBody: '安全模式会在桌面版私有数据目录中创建一次性的 DSH Home，不读取当前正常使用的 DSH 数据目录，因此插件、设置、会话和工作区记录都会从全新环境开始。退出或重启安全模式后，下一次普通启动会自动删除临时环境。',
  safeModeActiveBody: '当前恢复流程已处于安全模式。你可以回滚或切换临时 Profile；重启后将退出安全模式。',
  safeModeUnavailable: '当前启动阶段无法创建安全模式环境，但仍可查看诊断信息。',
  enterSafeMode: '进入安全模式',
  checkpoints: '健康启动 Checkpoint',
  checkpointsUnavailable: '当前启动阶段无法读取 Checkpoint 信息。',
  rollbackBody: '从三个健康启动槽位中选择一个，同时恢复当前 Profile、共享 settings.yaml 和 DSH home 补丁。',
  noHealthyStartup: '该槽位尚未记录任何健康启动。',
  availableSlot: '可回滚',
  emptySlot: '空槽',
  openCheckpoint: '浏览文件',
  rollbackCheckpoint: '回滚到此槽位',
  desktopVersion: '桌面端版本',
  pluginCount: '插件',
  configurationFileCount: '配置文件',
  checkpointSize: 'Checkpoint 大小',
  unknown: '未知',
  plugins: '插件管理',
  pluginsBody: '使用官方 DSH 插件命令，从当前 Profile 中卸载直接依赖的插件。',
  pluginsUnavailable: '当前启动阶段无法读取插件信息。',
  pluginsEmpty: '当前 Profile 中没有插件。',
  core: '内置组件',
  profileDependency: 'Profile 直接依赖',
  external: '不可直接卸载',
  isolatedPlugins: '隔离的插件',
  isolatedPluginsBody: '恢复模式已把这些插件排除在外。确认某个插件是原因后可以卸载它，卸错了也可以恢复。',
  isolatedPluginsEmpty: '当前没有隔离的插件。',
  disabled: '已禁用',
  uninstall: '卸载',
  restore: '恢复',
  keepIsolated: '保持隔离',
  diagnostics: '诊断包',
  savingDiagnostics: '正在保存本地诊断包…',
  diagnosticsSaved: '诊断包已保存在本地，不会自动上传。',
  diagnosticsFailed: '无法保存诊断包，可以重新尝试导出。',
  saveDiagnostics: '导出诊断',
  showDiagnostics: '在文件夹中显示',
  privacy: '诊断包可能包含本地路径、日志、系统信息和崩溃内存片段，分享前请先检查。',
  configurationFiles: '配置文件',
  configurationFilesBody: '查看或编辑当前 Profile 与 DSH home 的共享配置。修改后需要重新启动 DSH My Desktop。',
  openSettingsDocument: '打开 settings.yaml',
  openProfilePatch: '编辑 Profile 补丁',
  openProfileManifest: '编辑插件清单',
  openProfileDirectory: '打开 Profile 目录',
  startupLog: '启动日志',
  startupLogBody: '最近一次 DSH 启动失败时记录的内容。可选中复制，便于排查或上报。',
  startupLogEmpty: '没有启动日志。可能尚未发生过启动失败。',
  profiles: '可用 Profile',
  profilesBody: '在插件 Host 启动前切换到其他支持桌面端的 Profile，或新建一个 Profile。',
  profilesUnavailable: '当前启动阶段无法切换 Profile。',
  profilesEmpty: '没有其他支持桌面端的 Profile。',
  switchProfile: '切换',
  addProfile: '新建 Profile',
  resetAndDataManagement: '重置与数据管理',
  dataManagement: '数据管理',
  dataManagementBody: '这里显示当前桌面端正在使用的 DSH 数据目录。Profile、插件、设置和会话等数据会从该目录加载和保存；更改目录不会删除原目录中的数据。',
  currentDataDirectory: '当前数据目录',
  changeDataDirectory: '更改数据目录',
  restoreDefaultDataDirectory: '恢复默认',
  dataDirectoryUnavailable: '尚未解析出当前 DSH Home，或正处于安全模式，因此暂时无法管理用户数据目录。',
  dataDirectoryPath: '新的数据目录',
  dataDirectoryPlaceholder: '输入完整路径',
  selectDataDirectory: '选择 DSH 数据目录',
  browse: '浏览…',
  applyDataDirectory: '更改目录并重启',
  cancelDataDirectoryChange: '取消更改',
  factoryReset: '恢复出厂设置',
  factoryResetBody: '将当前 DSH 数据目录移入系统废纸篓或回收站，然后重启并重新创建干净的默认 Profile。不会删除该目录以外的项目文件。',
  factoryResetAction: '重置并重装',
  restart: '重启 DSH My Desktop',
  quit: '退出',
  working: '正在应用恢复操作…',
  back: '返回',
  cancel: '取消',
}

const EN: RecoveryCopy = {
  title: 'DSH My Desktop Recovery',
  fallbackBody: 'Recovery information could not be read. Quit and restart DSH My Desktop.',
  reason: 'Why recovery mode started',
  requestedMode: 'Requested from the restart menu',
  requestedBody: 'Normal startup is paused; the current Profile and plugin Host are not loaded.',
  currentProfile: 'Current Profile',
  currentProfileDirectory: 'Profile directory',
  failureStage: 'Failure stage',
  stageLabels: {
    'electron-ready': 'Electron startup',
    'shell-environment': 'Shell environment',
    'runtime-bootstrap': 'Desktop runtime',
    'profile-selection': 'Profile selection',
    'profile-composition': 'Plugin composition',
    'host-boot': 'Plugin host boot',
    'renderer-startup': 'Desktop UI startup',
    'health-commit': 'Startup health commit',
  },
  tabs: {
    quick: 'Quick recovery',
    plugins: 'Plugin management',
    rollback: 'Rollback',
    profiles: 'Switch Profile',
    data: 'Reset & data',
    diagnostics: 'Diagnostics',
  },
  quickRecovery: 'Quick recovery',
  quickRecoveryBody: 'Start with Safe Mode, then work through the navigation above from left to right. Each step below explains what it is for; changes take effect after a restart.',
  pluginGuideBody: 'If the problem disappears in Safe Mode, open "Plugin management" and uninstall the most likely plugin from the current Profile.',
  rollbackGuideBody: 'If uninstalling plugins is not enough, roll back to a healthy-startup Checkpoint from before the failure.',
  profileSwitchGuideBody: 'Switching to another Profile (or creating one) restores normal use while keeping the current Profile for later investigation.',
  dataGuideBody: 'You can change the folder data loads from; only try a factory reset when the options above have not helped.',
  diagnosticsGuideBody: 'To investigate further or ask for help, export a local diagnostics bundle and review the current configuration files.',
  safeMode: 'Safe Mode',
  safeModeBody: 'Safe Mode creates a one-off DSH Home in the desktop app\u2019s private data directory and does not read your normal DSH data directory, so plugins, settings, sessions and workspace records all start fresh. Restarting or leaving Safe Mode deletes the temporary environment.',
  safeModeActiveBody: 'This recovery session is running in Safe Mode. You can roll back or switch the temporary Profile; restarting leaves Safe Mode.',
  safeModeUnavailable: 'Safe Mode cannot be created at this startup stage, but diagnostics are still available.',
  enterSafeMode: 'Enter Safe Mode',
  checkpoints: 'Healthy-startup Checkpoints',
  checkpointsUnavailable: 'Checkpoint information cannot be read at this startup stage.',
  rollbackBody: 'Choose one of the three healthy-startup slots to restore the current Profile together with the shared settings.yaml and DSH home patches.',
  noHealthyStartup: 'No healthy startup has been recorded in this slot.',
  availableSlot: 'Available',
  emptySlot: 'Empty',
  openCheckpoint: 'Browse files',
  rollbackCheckpoint: 'Roll back to this slot',
  desktopVersion: 'DSH My Desktop version',
  pluginCount: 'Plugins',
  configurationFileCount: 'Configuration files',
  checkpointSize: 'Checkpoint size',
  unknown: 'Unknown',
  plugins: 'Plugin management',
  pluginsBody: 'Uninstall plugins that the current Profile depends on directly, using the official DSH plugin command.',
  pluginsUnavailable: 'Plugin information cannot be read at this startup stage.',
  pluginsEmpty: 'The current Profile has no plugins.',
  core: 'Built-in',
  profileDependency: 'Profile dependency',
  external: 'Not directly removable',
  isolatedPlugins: 'Isolated plugins',
  isolatedPluginsBody: 'Recovery mode has set these plugins aside. Uninstall the one you have identified as the cause, or restore it if you are wrong.',
  isolatedPluginsEmpty: 'No plugins are currently isolated.',
  disabled: 'Disabled',
  uninstall: 'Uninstall',
  restore: 'Restore',
  keepIsolated: 'Keep isolated',
  diagnostics: 'Diagnostics bundle',
  savingDiagnostics: 'Saving the local diagnostics bundle\u2026',
  diagnosticsSaved: 'The diagnostics bundle was saved locally and is not uploaded automatically.',
  diagnosticsFailed: 'The diagnostics bundle could not be saved; you can try exporting again.',
  saveDiagnostics: 'Export diagnostics',
  showDiagnostics: 'Show in folder',
  privacy: 'Diagnostics bundles may contain local paths, logs, system information and crash memory fragments. Review before sharing.',
  configurationFiles: 'Configuration files',
  configurationFilesBody: 'View or edit the shared configuration of the current Profile and the DSH home. Changes require restarting DSH My Desktop.',
  openSettingsDocument: 'Open settings.yaml',
  openProfilePatch: 'Edit Profile patch',
  openProfileManifest: 'Edit plugin manifest',
  openProfileDirectory: 'Open Profile directory',
  startupLog: 'Startup log',
  startupLogBody: 'Recorded when DSH last failed to start. Selectable, so it can be copied into a report.',
  startupLogEmpty: 'No startup log. A startup failure may not have happened yet.',
  profiles: 'Available Profiles',
  profilesBody: 'Switch to another desktop-capable Profile before the plugin Host starts, or create a new one.',
  profilesUnavailable: 'Profiles cannot be switched at this startup stage.',
  profilesEmpty: 'No other desktop-capable Profile.',
  switchProfile: 'Switch',
  addProfile: 'New Profile',
  resetAndDataManagement: 'Reset & data',
  dataManagement: 'Data management',
  dataManagementBody: 'This is the DSH data directory the desktop app is using. Profiles, plugins, settings and sessions are loaded from and saved to it; changing the directory does not delete the old one.',
  currentDataDirectory: 'Current data directory',
  changeDataDirectory: 'Change data directory',
  restoreDefaultDataDirectory: 'Restore default',
  dataDirectoryUnavailable: 'The current DSH Home is not resolved yet, or Safe Mode is active, so the data directory cannot be managed right now.',
  dataDirectoryPath: 'New data directory',
  dataDirectoryPlaceholder: 'Enter a full path',
  selectDataDirectory: 'Choose the DSH data directory',
  browse: 'Browse\u2026',
  applyDataDirectory: 'Change directory and restart',
  cancelDataDirectoryChange: 'Cancel change',
  factoryReset: 'Factory reset',
  factoryResetBody: 'Moves the current DSH data directory to the system trash, then restarts and recreates a clean default Profile. Files outside that directory are not deleted.',
  factoryResetAction: 'Reset and reinstall',
  restart: 'Restart DSH My Desktop',
  quit: 'Quit',
  working: 'Applying the recovery action\u2026',
  back: 'Back',
  cancel: 'Cancel',
}

/** The copy table for a locale. Both tables share one shape, so a gap is a type error. */
export function recoveryCopy(locale: 'zh' | 'en'): RecoveryCopy {
  return locale === 'zh' ? ZH : EN
}
