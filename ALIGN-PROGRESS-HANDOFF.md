# dsh-my-desktop — 与 dsh-desktop 对齐 实施进度与交接（本轮）

> 目标（用户已批准 DESIGN-align-dsh-desktop.md）：把 `dsh-my-desktop` 及其 `dsh-my-desktop-setting`
> 改造成与 `dsh-plugin-desktop` **界面与功能完全对齐（原生耦合）**。横跨两个仓库，分 P1–P5。

## 本轮已交付并验证

1. **403 修复（上一阶段，已完成）**
   - 插件同源守卫 `normalizeOrigin`/`isSameOrigin` 缺陷修复，已同步到源码 + 各构建副本 +
     **安装版资源**（`D:\Program Files\DSH My Desktop\resources\dsh-my-desktop-setting\lib\index.js`，
     经提权/UAC 完成）+ `%APPDATA%` 物化副本。重启后桌面设置应可正常读取。

2. **设计与差距文档（已批准）**
   - `dsh-my-desktop-setting/DESIGN-align-dsh-desktop.md`：参考实现结构、现状差距、
     关键架构分歧（dsh-desktop 单进程 in-process host vs dsh-my-desktop 子进程承载）、
     P1–P5 分阶段方案、关键取舍。三个调研子代理产出文件级插入点已并入。

3. **P1 启动器已完成（tsc + build(dist) 均 EXIT=0，dist/src/profiles.js + desktop-host.js 已产出）**
   - 新增 `dsh-my-desktop/src/profiles.ts`：
     `ManagedProfile/listProfiles/createProfileDirectory/deleteProfileDirectory/readActiveProfile/
     writeActiveProfile/assertProfileName/profileDirFor/resolveProfileRoots`。registry 落
     `userData/profile-registry.json`，默认 active = `web`（向后兼容）。名称校验对齐 dsh-desktop。
   - `plugin-seed.ts` `ensureProfileScaffold(profileDir, profileName?)`：按名写 `dsh-profile-<name>`。
   - `main.ts` 启动读 active → `profileDirFor(home, active)` → `DSH_PROFILE_NAME: active`；
     启动 env 注入 `DSH_PROFILE_SELECTION_DIR: userData`。
   - main 侧 profile 操作：`createWebProfile(name)`（复用 `lastSeedOptions` 对目标 dir 跑
     `seedBundledPlugins`）、`switchWebProfile(name)`（校验 selectable → `writeActiveProfile` →
     `restartDesktop()` relaunch，启动自然读到新 active）、`deleteWebProfile(name)`、`desktopProfileViews()`。
   - `desktop-host.ts` `createDesktopHostServices` 的 `desktopProfiles` 真实化：`active`、
     `list()` 读 profiles.ts(FS)、`create/select/delete` 发 `DesktopProfileActionMessage`
     子进程→主进程 IPC（fire-and-forget）。
   - `desktop-bridge.mts` 传 `profileRoots`（home=DSH_HOME，stateDir=DSH_PROFILE_SELECTION_DIR）。
   - `main.ts` `handleDshIpc` 分发 `desktop/profile/create|select|delete` 到上述 main 操作。
   - `DESKTOP_BRIDGE_FILES` 增加 `profiles.js`（桥包随包运行时依赖）。

4. **P2 宿主桥（launcher 侧，本轮，tsc + build(dist) 均 EXIT=0）**
   - `desktop-host.ts` 新增 `DesktopActionMessage`（`desktop/action/restart|terminal/open|devtools/toggle`）
     + `isDesktopHostMessage`；`createDesktopHostServices` 新增 `desktopRuntime` 服务，提供
     `requestRestart()/openTerminal()/toggleDeveloperTools()`（经 IPC fire-and-forget 到 main）。
   - `desktop-bridge.mts` 把 `desktopRuntime` 也 provide/set 到 ctx。
   - `main.ts` `handleDshIpc` 分发 action：restart→`restartDesktop()`、terminal→`openDshTerminal()`、
     devtools→`toggleDeveloperTools()`。
   - `openDshTerminal` 的 `profileName` 改为读当前启动 profile（`basename(lastSeedOptions.profileDir)`）/
     active，不再写死 `'web'`。
   - 效果：web profile 内插件 `probeHost` 现在能看到 `desktopRuntime`(connected)，`probeLauncherPorts`
     会接到 requestRestart/openTerminal/toggleDeveloperTools → 插件里对应宿主动作从 501 变为可用。

5. **P3 插件 host 前段（本轮，plugin host+client tsc EXIT=0；`pnpm run build` 通过，
   lib/index.js+client.js 已重生成并同步到 launcher dist/desktop-settings-plugin）**
   - `dsh-my-desktop-setting/src/host-capability.ts`：`HostServiceAccess` 增加 `profileList`/
     `selectProfile`；`detectHostCapability` 优先用 `desktopProfiles.list()` 的真实 profile 列表（有
     current 标注），否则回退到单 env profile。
   - `host-controller.ts`：`HostActionPorts` 增加 `selectProfile`；`launcherSupport().profileSwitch`
     改为 `this.ports.selectProfile !== undefined`；新增 `controller.selectProfile(name)`。
   - `index.ts` `probeHost`：读 `desktopProfiles.list()/select/active`，产出 `profileList`+`selectProfile`；
     `apply` 把 `hostAccess.selectProfile` 并入 controller ports。
   - 效果：当 launcher 经 bridge 暴露真实 `desktopProfiles`（list + select）时，插件 read 会列出真实
     profile、`host.profile-switch` capability 变为 supported 并可经 `selectProfile(name)` 触发 relaunch。

6. **P3 host + P4 client 前段（本轮，plugin host+client tsc EXIT=0；`pnpm run build` 通过并已同步
   lib/index.js+client.js → launcher dist/desktop-settings-plugin）**
   - contract：`SettingsProfileView` 增加可选 `exists/webCapable/selectable/deletable`；新增
     `SettingsProfileRequest{name}` + `settingsPaths.profileCreate/profileDelete`。
   - host：`host-capability` 增加 `ProfileBridgeItem`、`HostServiceAccess.createProfile/deleteProfile`、
     `detectHostCapability` 透传可选 profile 标志；`host-controller` 增加 `createProfile/deleteProfile` +
     `profileManagementSupported` getter；`index.ts probeHost` 读 `desktopProfiles.create/delete`；
     `http-handlers` 新增 `handleProfileCreate/Switch/Delete`（收 `{name}`，调用 controller）；把
     profileSwitch 移出 `HOST_ACTION_TOKENS` 改为按 name 路由注册。
   - client：`desktop-settings-api` 新增 `createProfile/selectProfile/deleteProfile` 方法与
     parseProfile 可选标志；`DesktopSettingsSection.tsx` 在 Profile 组新增每 profile「切换到此 Profile /
     删除(确认)」按钮 + 「新建 Profile」输入框（仅当 `host.profile-switch` supported 且 desktopHost 时出现）；
     新增 zh/en locale 键（switchProfile/switchingProfile/createProfile/creatingProfile/deleteProfile/
     deletingProfile/confirmDeleteProfile/cancel/newProfileName/newProfilePlaceholder）。
   - 效果：接上新 launcher bridge 后，桌面设置 Profile 区可从「只读身份」变为可真实「新建/切换/删除」
     profile（切换=持久化 active + relaunch）。

7. **Round 4 回归测试通过（launcher 测试套件）**
   - 为让新 desktopRuntime/profiles.js 不破坏测试，更新了 `test/desktop-bridge-environment.test.ts`
     （bridge 现在提供 3 个服务）+ `package.json` `build.extraResources` desktop-bridge filter 加入
     `profiles.js`（与 `prepare-runtime.test.ts` 的闭包断言一致）。
   - 实测：`desktop-host.test.js`、`desktop-bridge-environment.test.js`、`plugin-seed.test.js`、
     `desktop-settings-plugin.test.js` 全绿（37/37）；`desktop-bridge 资源清单` 用例通过。
   - 全量 320 用例：313 pass / 6 fail —— 其中 4 个是已知的 `.github/workflows` 缺失导致（AGENTS.md 已记录），
     1 个 `profile-repair`「官方 Web bundle 缺失」为与本改动无关的既有失败；非既有缺口、与本改动相关的均已修复。

8. **Round 5 运行时探测（说明 e2e 为何需用户重打包/重启）**
   - 机器上 **`DSH My Desktop` 正在运行**（PID 14432 持有主窗口），另有 `DSH Desktop`（14156，DeepSeek Harness
     Desktop）也开着。
   - dev 冒烟启动立即退出码 0 的原因 = **single-instance lock 已被运行中的实例持有**（`app.requestSingleInstanceLock()`
     → 二次启动 `app.quit()`），不是代码回归；Electron v44.1.1 与 node v24.11.1 均正常。
   - 已验证发运产物正确：`lib/index.js`/`lib/client.js` 与 launcher `dist/desktop-settings-plugin` 均含
     profile create/switch/delete 逻辑；`profiles.js` 已进 bridge 闭包。
   - **结论**：要跑 e2e 只能重打包并重启“运行中的实例”或另开实例；重启/占用主窗口属用户侧操作。

9. **Round 6 打包装配已验证（无需 GUI）**
   - 运行 `node dist/scripts/prepare-runtime.js --stage-plugin`（= `build.ps1 -Target dist-local` 前的
     装配步骤）成功：`已装配随包桌面设置插件 …dist/desktop-settings-plugin`。
   - 校验 staged 产物：`lib/index.js`/`lib/client.js` 均含 profile create/select/delete；装配出的
     `cordis.patch.yml + lib/{index,client}.js` 结构正确。
   - 另：带独立 `--user-data-dir` 的 dev 启动会触发完整首启（运行时解包 + 联网补种，需数分钟），在本会话
     无 GUI/受限网络下不可行；single-instance 锁也阻止占用运行中的实例。故 e2e 运行验证确为会话内不可行。

9. **Round 9 突破：bridge 跨 ctx 可见性已修通（真机自检确证）**
   - 现象回顾：装新插件后自检一直 `desktopHost=true · bridges= · profileSwitch=false`，虽 bridge --patch
     已传进子进程、桥文件齐全、marker 显示 bridge apply 执行并 provide，但插件仍读不到服务。
   - **根因**：dsh-my-desktop 用两条独立 `--patch` 行（`dsh-desktop-bridge` 与 `dsh-my-desktop-setting`），
     Cordis 每个 loader 条目 ctx 作用域隔离；桥把服务 provide 在**自身条目 ctx**（错误栈证
     `service "desktopProfiles" has been registered at <dsh-desktop-bridge>`），兄弟插件读不到。
     参考 dsh-desktop 是同进程单 ctx 才能读。
   - **修复**：`desktop-bridge.mts` 的 apply 把服务注册到 **`ctx.root`（所有 loader 行共享的根 ctx）**，
     且**只 provide 一次**（早前版本把 `ctx` 与 `ctx.root` 都 provide、或循环，导致二次注册崩溃
     `service has been registered`）。
   - **结果（用户真机自检）**：`bridges=desktopProfiles,desktopPnpm,desktopRuntime · profileSwitch=true ·
     profiles=web*,desktop`；Profile 桥接=已连接；UI 出现 desktop 的「删除/切换到此 Profile」按钮与
     「新 Profile 名称 / 新建 Profile」输入。多 profile 来自真实 `~/.dsh/profiles` 枚举（web + desktop，
     desktop 的 bundle 以 dsh-base,dsh-web-app 开头故 webCapable）。

10. **Round 10 根因二：切换 profile 后目标 profile 的插件没加载 —— `web` 子命令是 `--profile web` 硬编码**
   - 现象：用户点「切换 desktop」后 active=desktop、desktop 的诊断/marker 文件更新、healthy，但 desktop 的
     5 个插件（dsh-better-sidebar/dsh-context/dsh-vision-router/@michengai/dsh-agency-agents/
     @luoxunhao/dsh-codex-project）**没加载**。
   - **根因（dsh bin.js 证）**：DSH CLI 的 `web` 子命令 = **`--profile web` 的硬编码别名**（`dsh` 里
     `web` 永远 boot `web` profile）；真正的选择是 `--profile <name>`。而启动器 `dsh-process.ts`
     `DSH_WEB_LAUNCH_ARGS=['web',...]` 用 `web` 子命令，且 DSH **完全不读 `DSH_PROFILE_NAME`/`DSH_PROFILE_DIR`
     env**（全库 grep 无读取处）。所以切换后 DSH 仍起 web profile，只有我的桥/插件/启动器按 env 以为在 desktop。
   - **验证**：`dsh --profile desktop --dump-config` 的组成树含全部 5 个 desktop 插件；`--profile web` 不含。
   - **修复**：`dsh-process.ts` 启动参数改为 `['--profile', <activeName>, ...patchArgs, '--port', p, '--no-open']`
     （profile 选择必须在 `--patch` 与 web app 参数之前）；`StartDshOptions` 增 `profileName`；`main.ts`
     startOptions 传 `profileName: activeProfileName`。相应更新 `test/dsh-process.test.ts` 的期望参数。
     测试：dsh-process/desktop-host/desktop-bridge-environment 共 37/37 通过。
   - **待做**：需重打包（`build.ps1 -Target dist-local`）让安装版 `app.asar` 含此修复，再重启验证切换 desktop
     后其插件真正加载。

## 下一步（下一轮继续）

### P1 收尾（验证）
- 真机验证：dev(`pnpm start`) 或重打包安装版后，**默认 web profile 启动无回归**；新建 profile 出现、
  switch 后 app.relaunch 落到新 profile、delete 移除非 active。
- 说明：改的是 launcher 源码；**安装版**需 `scripts/build.ps1 -Target dist-local` 重打包，
  `%APPDATA%` 的 `desktop-bridge`/`desktop-settings-plugin` 才带上 profiles.js 等新文件。

### P2 剩余 + P4 收尾
- P2 剩余：材质/mode（经 dsh-desktop settings namespace → main 窗口）、通知 turn/job 宿主、
  localUrl/inactive 只读、diagnostics 导出（dsh-my-desktop 尚无，先不接）。
- P4 收尾：真机里核对新建/切换/删除交互与文案；后续如需与 dsh-desktop 逐像素对齐（114 zh/en key、
  更贴近参考的区块顺序），可继续把 section 逐步改到参考结构。
- P5 打包（`scripts/build.ps1 -Target dist-local`）+ 端到端验收（安装版真机）。

## 关键文件/接入点（调研确认）
- profile：`plugin-seed.ts:140 resolveWebProfileDir`、`:457 ensureProfileScaffold`、`:355 seedBundledPlugins`。
- 启动/回收：`main.ts:186`(profileDir)、`:272`(DSH_PROFILE_NAME)、`:686 recycleDshForPluginUpdate`、
  `:416 createMainWindow`、`:541 openWorkbenchOrRecovery`。
- 桥：`desktop-host.ts:119 createDesktopHostServices`、`desktop-host.ts:172 select`(no-op)、
  `desktop-bridge.mts apply`(仅 desktopProfiles/desktopPnpm)。
- 插件：`dsh-my-desktop-setting/src/*`（contract/host-controller/http-handlers/index + client/*）。

## 验证命令
- 启动器：`cd E:\project\dsh\dsh-my-desktop && npx tsc --noEmit`（本轮已 EXIT=0）。
- 插件：`cd E:\project\dsh\dsh-my-desktop-setting && pnpm run typecheck` / `pnpm run build`。
- 出包：`pwsh scripts/build.ps1 -Target dist-local`（dsh-my-desktop）。
