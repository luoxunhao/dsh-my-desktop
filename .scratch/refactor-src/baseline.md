# 重构基线（ticket 01 产物）

采集时间：ticket 01 执行时。**此文件是后续所有 ticket 判断「行为未变」的依据。**

采集前工作区状态：干净（HEAD = `32348a8`），应用未运行。

## 打包产物哈希

命令：`pwsh -File scripts\build.ps1 -Target dist-local`，产物在 `release\win-unpacked\resources\`。

### 桌面设置插件

| 文件 | SHA256 |
|---|---|
| `dsh-my-desktop-setting/lib/index.js` | `4AFEE822327294515F009AB01416FEDCD21E3E90E11DBC815DE38ECA4C1CC396` |
| `dsh-my-desktop-setting/lib/client.js` | `ED4DA198E2F271BE5312AC2BA563738A84F0D0AE2045C172124AD3DE00F25F83` |

### desktop-bridge（15 个文件）

| 文件 | SHA256 |
|---|---|
| `atomic-file.js` | `44C57C624B32B71F60FCEAD506F560A58DA352E227167DC7E5C3023C7456491E` |
| `bundled-plugins.js` | `55056F3170389BA348E577CACCC952AFA86D8957DCE9D69C35BAB1039419CE23` |
| `desktop-bridge-client-source.js` | `3AE9E40869360BDDDA2F49DDD95DFFEF9E27F875E656A934828B8C8DAF68776D` |
| `desktop-bridge.mjs` | `CB03FE9D7A6B315F8FCF33091D9B731424470D4BAF149E938F5C24FDD7AB0283` |
| `desktop-host.js` | `A1BB3308553E24E31A23A674AABABD5989A72F6725516A9A2394B25C8297EE72` |
| `dsh-process.js` | `7DEEE4FB1C8089DC949F525731B5F18A8F29311A0884038B687593BE2C1E16CA` |
| `plugin-seed.js` | `AC7EE4F68AE8698CA12E399E60284095DC96473A46BE988B281E4B3A247A4ABD` |
| `plugin-toolchain.js` | `4C75E3AC35A583AD9B4CC3D46C152D3040FA469EED38C974CE9F2F73E5AD491D` |
| `process-control.js` | `69BE2F138E1FFB489DF69AB82A5A70BD76512C3AE7A03E15B5E4E7568A284351` |
| `profile-updates.js` | `F079E741ABF7FE30F5BCC281C4FF980854BFF0E772407ADDD1E92B5F822C5829` |
| `profiles.js` | `5CD28476055EE5A7B3774BDFBF8168E57161A6D71CA16E5A3BFAB872FEB6B32F` |
| `readiness.js` | `BFB563E51A8E7313150F312BA207B8F5D467083642EBD368D1B9FAF16279F89B` |
| `recovery-mode.js` | `54969846A440C19D75C8FC1D9CC586543FE6FF186CAAF30613EAF053D8653E71` |
| `runtime-archive.js` | `D680F7F9F55EDF5E2566F6804E22677213C57021CA360F5756EDFE41B4460BA1` |
| `runtime-prebuilt.js` | `4F5A97DE418FC7CABE0EFB2F7C20AE15773A38D7E0924B9AE93EF89919678FC3` |

**bridge 整体哈希**（按文件名排序，`名字␣␣哈希` 用 `\n` 连接后取 SHA256）：

```
E5EE14C3D70B068B66591E47C5E88A0FACA6227146B5A0D38C6722A154567535
```

## 测试基线

```
tests 327 / pass 321 / fail 5
```

5 项失败均为已知缺口：4 项读 `.github/workflows/desktop-package.yml`（本仓库无 `.github/`），
1 项 `profile-repair.test.ts` 的「官方 Web bundle 缺失时…」。重构后必须仍是**同样的 5 项**。

## 比对方式

```powershell
# 插件
(Get-FileHash "release\win-unpacked\resources\dsh-my-desktop-setting\lib\index.js" -Algorithm SHA256).Hash

# bridge 整体
$lines = Get-ChildItem "release\win-unpacked\resources\desktop-bridge" -File |
  Sort-Object Name | ForEach-Object { "$($_.Name)  $((Get-FileHash $_.FullName -Algorithm SHA256).Hash)" }
$sha = [System.Security.Cryptography.SHA256]::Create()
[System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))) -replace '-','')
```

## 重要说明

**为什么这些哈希应该保持不变**：本次重构是纯结构性的（移动文件、改状态访问方式），
不改变任何运行时逻辑。因此 `dist/` 编译产物应当逐字节相同。

**若某个 ticket 后哈希变化**：说明引入了非预期的行为变化。ticket 01~03 要求严格一致；
04 起（合并重复逻辑、打破循环依赖）可能有合理差异，**届时必须停下来向用户报告原因**，
不得默默接受。
