# Changelog

[简体中文](CHANGELOG.zh-CN.md)

## 0.1.0

Initial release of **DSH Desktop**, a native Electron launcher for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

This version is a launcher / desktop shell:

- It bundles **no community plugin** (`BUNDLED_PLUGINS` is empty) and
  preinstalls none.
- It ships the Electron desktop shell, a bundled Node.js + pnpm runtime, and
  the official DSH core runtime needed to boot a local `web` profile.
- Plugins are installed by the user at runtime (for example with
  `dsh plugin --profile web add <package>`, or by installing a market plugin
  such as `dshmarket` into the profile). Nothing is bundled in the installer.

What this version provides:

- A native desktop window (with tray, notifications, theme, zoom, window state).
- Boots a local DSH core on a validated `127.0.0.1` loopback address and keeps
  its web UI inside the desktop shell.
- A desktop bridge injected only when Desktop starts DSH; running `dsh web`
  manually uses the normal Web plugin path.
- Startup self-repair that strips invalid profile entries before booting DSH.

The chat / workbench UI you see is provided by DSH core and the plugins you
install into its `web` profile; this project does not implement that UI itself.

Release tag: [`v0.1.0`](https://github.com/luoxunhao/dsh-my-desktop/tree/v0.1.0).
