/**
 * Local diagnostics bundle for the recovery page.
 *
 * WHAT GOES IN
 * ------------
 * Only what a report needs: the startup diagnostic, the startup error log, and the
 * profile manifest — each as its own delimited text section. It deliberately does
 * NOT sweep the data directory: sessions and workspaces can carry user content, and
 * the bundle is meant to be shared.
 *
 * FORMAT
 * ------
 * A plain `.txt` with delimited sections rather than a zip: it opens in any editor
 * with no extra tooling, which matters when the reporter is already having a bad
 * day. Everything is text the app already produces.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SECTION = '────'

/** One delimited section; a missing file reads as （不存在） rather than failing. */
async function section(title: string, path: string): Promise<string> {
  let body = ''
  try {
    body = await readFile(path, 'utf8')
  } catch (error) {
    const code = (error as { code?: string }).code
    body = code === 'ENOENT' ? '（不存在）' : `（读取失败：${error instanceof Error ? error.message : String(error)}）`
  }
  return `${SECTION} ${title} — ${path} ${SECTION}\n\n${body || '（空）'}\n\n`
}

/** Inputs the caller resolves once; the module itself stays free of Electron. */
export interface DiagnosticsBundleOptions {
  readonly userDataDir: string
  readonly profileDir: string
  readonly homeDir: string
  readonly appVersion: string
  readonly now: () => Date
}

/**
 * Write the bundle into the userData root and resolve its file name, so the page
 * can display it and "show in folder" can reveal it.
 */
export async function writeRecoveryDiagnosticsBundle(options: DiagnosticsBundleOptions): Promise<string> {
  const stamp = options.now().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const filename = `dsh-recovery-diagnostics-${stamp}.txt`
  const outPath = join(options.userDataDir, filename)

  const diagnosticPath = join(options.profileDir, '.dsh-desktop-startup-diagnostics.json')
  const errorLogPath = join(options.profileDir, '.dsh-desktop-startup-error.log')
  const manifestPath = join(options.profileDir, 'package.json')

  let diagnostic = 'null'
  try {
    const raw = await readFile(diagnosticPath, 'utf8')
    diagnostic = JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    // A missing or malformed diagnostic is still worth shipping — say so in place.
    diagnostic = `（无法读取：${diagnosticPath}）`
  }

  const header = `DSH My Desktop 恢复诊断包  ${options.now().toISOString()}\n应用版本：${options.appVersion}\n\n`
  const parts: string[] = [
    header,
    `${SECTION} 启动诊断 — ${diagnosticPath} ${SECTION}\n\n${diagnostic}\n\n`,
    await section('启动错误日志', errorLogPath),
    await section('Profile 清单', manifestPath),
  ]
  await writeFile(outPath, parts.join(''), 'utf8')
  return filename
}
