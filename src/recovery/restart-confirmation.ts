/**
 * The confirmation shown before restarting the desktop app.
 *
 * MODELLED ON dsh-desktop's `desktopRestartConfirmationCopy` (tray-locale.ts), with
 * the same wording and — crucially — the same default button.
 *
 * WHY THE DEFAULT BUTTON MATTERS
 * ------------------------------
 * Entering recovery interrupts whatever is running and relaunches the whole app.
 * The reference makes the DEFAULT button "Cancel" (`defaultId: 1`), so a stray
 * Enter dismisses the dialog instead of destroying the current session. The
 * constant is exported and tested rather than inlined, because it is the kind of
 * number a later "fix" would silently flip.
 *
 * Copy is kept here rather than in the dialog module so the wording is testable
 * without Electron.
 */

export interface RestartConfirmationCopy {
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly confirm: string
  readonly cancel: string
  /** Button labels in render order: confirm first, cancel second. */
  readonly buttons: readonly [string, string]
  /** Index of the default button — deliberately Cancel. */
  readonly defaultId: number
  /** Index returned when the dialog is dismissed. */
  readonly cancelId: number
}

/** Index of the Cancel button. `defaultId` and `cancelId` both point here on purpose. */
export const DESKTOP_RECOVERY_CONFIRM_DEFAULT_ID = 1

export type RestartTarget = 'normal' | 'recovery'

interface CopyFields {
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly confirm: string
  readonly cancel: string
}

const COPY: Record<'zh' | 'en', Record<RestartTarget, CopyFields>> = {
  en: {
    normal: {
      title: 'Restart DSH Desktop',
      message: 'Restart DSH Desktop now?',
      detail: 'Running operations and unsent input may be interrupted. Saved settings will not be lost.',
      confirm: 'Restart',
      cancel: 'Cancel',
    },
    recovery: {
      title: 'Restart in Recovery Mode',
      message: 'Restart DSH Desktop in Recovery Mode?',
      detail: 'The next launch opens the recovery assistant before the Profile and plugin Host start. Running operations and unsent input may be interrupted.',
      confirm: 'Restart in Recovery Mode',
      cancel: 'Cancel',
    },
  },
  zh: {
    normal: {
      title: '重启 DSH Desktop',
      message: '现在重启 DSH Desktop？',
      detail: '正在运行的操作和未发送的输入可能会中断，已保存的设置不会丢失。',
      confirm: '重启',
      cancel: '取消',
    },
    recovery: {
      title: '重启到恢复模式',
      message: '重启 DSH Desktop 并进入恢复模式？',
      detail: '下次启动会在 Profile 和插件 Host 运行前打开恢复助手。正在运行的操作和未发送的输入可能会中断。',
      confirm: '重启到恢复模式',
      cancel: '取消',
    },
  },
}

/** Resolve the dialog copy for a locale and restart target. */
export function restartConfirmationCopy(
  locale: string,
  target: RestartTarget = 'normal',
): RestartConfirmationCopy {
  const fields = COPY[locale.startsWith('zh') ? 'zh' : 'en'][target]
  return {
    ...fields,
    buttons: [fields.confirm, fields.cancel],
    defaultId: DESKTOP_RECOVERY_CONFIRM_DEFAULT_ID,
    cancelId: DESKTOP_RECOVERY_CONFIRM_DEFAULT_ID,
  }
}
