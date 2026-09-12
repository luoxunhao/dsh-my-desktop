/**
 * The desktop settings window.
 *
 * This is the React replacement for `assets/settings.html` (235 lines of
 * HTML + CSS + imperative JS). It is the launcher's most interactive surface, and
 * the port preserves three behaviors that are easy to lose:
 *
 * 1. SAVES ARE ECHO-BACK. Both preference setters return the STORED value, and
 *    the UI re-renders from that response rather than from what the user clicked.
 *    That is deliberate: the main process normalizes and can reject input, so the
 *    response is the truth. Writing local state optimistically would desync the
 *    UI from disk whenever normalization kicks in.
 *
 * 2. ESCAPE CLOSES THE WINDOW, BUT ONLY WHEN NO LISTBOX IS OPEN. An open listbox
 *    consumes Escape to dismiss itself; letting it also close the window would
 *    make the first Escape destructive. The original gated on
 *    `[role="listbox"]:not([hidden])`, and the Listbox primitive reproduces that
 *    by handling Escape in its own keydown and calling `preventDefault()`.
 *
 * 3. THE UPDATE FEEDBACK LINE IS SHARED between the policy save message and the
 *    update-state message. They are one slot, so a save confirmation is
 *    legitimately replaced by the next state render.
 *
 * The page has two sections sharing one layout; `section` is the active page id.
 */

import { useCallback, useEffect, useState } from 'react'

import { applyColorScheme, isZhLocale, localize, shellBridge } from './api.js'
import type { ShellBootstrap } from './api.js'
import { Listbox, type SelectOption } from './Listbox.js'
import { SwitchRow } from './SwitchRow.js'

type CompletionMode = 'off' | 'unfocused' | 'always'
type UpdatePolicy = 'notify' | 'auto-download' | 'manual'
type Section = 'notifications' | 'updates'

interface NotificationPreferences {
  readonly turnMode: CompletionMode
  readonly approvalsEnabled: boolean
  readonly questionsEnabled: boolean
}

type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; releaseNotes?: string }
  | { kind: 'none' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string }

interface UpdateSnapshot {
  readonly currentVersion: string
  readonly lastCheckedAt?: string
  readonly packaged: boolean
  readonly status: UpdateStatus
}

const COMPLETION_MODES: readonly CompletionMode[] = ['off', 'unfocused', 'always']
const UPDATE_POLICIES: readonly UpdatePolicy[] = ['notify', 'auto-download', 'manual']

const FALLBACK_NOTIFICATIONS: NotificationPreferences = { turnMode: 'unfocused', approvalsEnabled: true, questionsEnabled: true }
const FALLBACK_UPDATE: UpdateSnapshot = { currentVersion: '—', packaged: false, status: { kind: 'idle' } }

/** Localized labels for the three completion modes, in `COMPLETION_MODES` order. */
function completionOptions(locale: string): readonly SelectOption<CompletionMode>[] {
  const zh = isZhLocale(locale)
  const labels = zh
    ? ['从不', '仅在窗口未聚焦时', '始终']
    : ['Never', 'Only when unfocused', 'Always']
  return COMPLETION_MODES.map((value, index) => ({ value, label: labels[index] ?? value }))
}

function policyOptions(locale: string): readonly SelectOption<UpdatePolicy>[] {
  const zh = isZhLocale(locale)
  const labels = zh
    ? ['自动检查并提醒', '自动下载，安装前提醒', '仅手动检查']
    : ['Check automatically and notify', 'Download automatically, ask before install', 'Check manually only']
  return UPDATE_POLICIES.map((value, index) => ({ value, label: labels[index] ?? value }))
}

/** Format the last-checked timestamp, tolerating an unparseable value. */
function formatChecked(locale: string, value: string | undefined): string {
  if (value === undefined || value === '') return localize(locale, '尚未检查', 'Not checked yet')
  try {
    const formatted = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    return localize(locale, `上次检查：${formatted}`, `Last checked: ${formatted}`)
  } catch {
    return localize(locale, '已检查', 'Checked')
  }
}

/** Everything the update panel derives from one snapshot. */
interface UpdateView {
  readonly badge: string
  readonly badgeKind: string
  readonly action: 'check' | 'download' | 'install'
  readonly actionLabel: string
  readonly disabled: boolean
  readonly feedback: string
  readonly feedbackIsError: boolean
  readonly releaseNotes: string | undefined
}

/**
 * Project an update snapshot into the strings and control states to render.
 *
 * Pure, so the precedence rules that the original expressed as a chain of `if`s
 * are testable and cannot drift: `packaged` outranks every status kind, because a
 * dev build has no update service to talk to at all.
 */
function updateView(locale: string, snapshot: UpdateSnapshot): UpdateView {
  const status = snapshot.status
  const percent = status.kind === 'downloading' ? Math.round(status.percent || 0) : 0

  const badge = ((): string => {
    switch (status.kind) {
      case 'checking': return localize(locale, '正在检查', 'Checking')
      case 'available': return localize(locale, '有新版本', 'Update available')
      case 'none': return localize(locale, '已是最新', 'Up to date')
      case 'downloading': return localize(locale, `下载中 ${percent}%`, `Downloading ${percent}%`)
      case 'ready': return localize(locale, '等待安装', 'Ready to install')
      case 'error': return localize(locale, '检查失败', 'Check failed')
      default: return localize(locale, '准备就绪', 'Ready')
    }
  })()

  const base: Omit<UpdateView, 'badge' | 'badgeKind'> = {
    action: 'check',
    actionLabel: localize(locale, '检查更新', 'Check for updates'),
    disabled: false,
    feedback: '',
    feedbackIsError: false,
    releaseNotes: undefined,
  }

  if (!snapshot.packaged) {
    return {
      ...base,
      badge,
      badgeKind: status.kind,
      disabled: true,
      feedback: localize(locale, '开发版本不连接发布更新服务。', 'Development builds do not connect to the release update service.'),
    }
  }

  switch (status.kind) {
    case 'checking':
      return { ...base, badge, badgeKind: 'checking', disabled: true, feedback: localize(locale, '正在检查新版本…', 'Checking for a new version…') }
    case 'available':
      return {
        ...base,
        badge,
        badgeKind: 'available',
        action: 'download',
        actionLabel: localize(locale, `下载 ${status.version}`, `Download ${status.version}`),
        feedback: localize(locale, `发现桌面端 ${status.version}。`, `Desktop ${status.version} is available.`),
        releaseNotes: status.releaseNotes,
      }
    case 'downloading':
      return { ...base, badge, badgeKind: 'downloading', disabled: true, feedback: localize(locale, `正在下载 ${percent}%…`, `Downloading ${percent}%…`) }
    case 'ready':
      return {
        ...base,
        badge,
        badgeKind: 'ready',
        action: 'install',
        actionLabel: localize(locale, '安装并重启', 'Install and restart'),
        feedback: localize(
          locale,
          `桌面端 ${status.version} 已下载。安装将关闭并重启应用，请先保存工作。`,
          `Desktop ${status.version} is downloaded. Installation closes and restarts the app, so save your work first.`,
        ),
      }
    case 'none':
      return { ...base, badge, badgeKind: 'none', feedback: localize(locale, '当前已是最新桌面端版本。', 'You already have the latest desktop version.') }
    case 'error':
      return {
        ...base,
        badge,
        badgeKind: 'error',
        feedback: status.message || localize(locale, '无法检查桌面端更新，请稍后重试。', 'Unable to check for desktop updates. Try again later.'),
        feedbackIsError: true,
      }
    default:
      return { ...base, badge, badgeKind: 'idle' }
  }
}

export function SettingsWindow(): React.JSX.Element | null {
  const [bootstrap, setBootstrap] = useState<ShellBootstrap | undefined>(undefined)
  const [section, setSection] = useState<Section>('notifications')
  const [notifications, setNotifications] = useState<NotificationPreferences>(FALLBACK_NOTIFICATIONS)
  const [policy, setPolicy] = useState<UpdatePolicy>('notify')
  const [update, setUpdate] = useState<UpdateSnapshot>(FALLBACK_UPDATE)
  const [saved, setSaved] = useState(false)
  /**
   * Transient message that outranks the derived update feedback.
   *
   * The policy-save confirmation and the update-state message share one line, as
   * in the original. Clearing this whenever a new snapshot arrives is what keeps
   * "policy saved" from sticking around under a fresh status.
   */
  const [feedbackOverride, setFeedbackOverride] = useState('')

  const locale = bootstrap?.locale ?? 'zh-CN'

  // Bootstrap: subscribe first, then read, so a broadcast landing between the two
  // is not lost. Same handshake as every other window.
  useEffect(() => {
    const api = shellBridge()
    let active = true
    const apply = (value: unknown): void => {
      if (!active) return
      const next = value as ShellBootstrap
      setBootstrap(next)
      applyColorScheme(next.colorScheme)
      document.documentElement.lang = next.locale
    }
    const unsubscribe = api.onBootstrap(apply)
    void api.getBootstrap().then(apply, () => undefined)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  // Initial read of all three preference sources at once. Each is independently
  // guarded: a rejected read leaves that slice at its fallback rather than
  // failing the whole window.
  useEffect(() => {
    const api = shellBridge()
    let active = true
    void Promise.all([
      api.getNotificationPreferences().then(value => value as NotificationPreferences, () => undefined),
      api.getUpdatePreferences().then(value => value as { policy: UpdatePolicy }, () => undefined),
      api.getDesktopUpdateState().then(value => value as UpdateSnapshot, () => undefined),
    ]).then(([prefs, preferences, state]) => {
      if (!active) return
      if (prefs !== undefined) setNotifications(prefs)
      if (preferences !== undefined) setPolicy(preferences.policy)
      if (state !== undefined) setUpdate(state)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const api = shellBridge()
    let active = true
    const apply = (value: unknown): void => {
      if (!active) return
      setUpdate(value as UpdateSnapshot)
      // A fresh snapshot supersedes any transient save confirmation: they share
      // one line, and stale text under new state reads as a broken update.
      setFeedbackOverride('')
    }
    const unsubscribe = api.onDesktopUpdateState(apply)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const api = shellBridge()
    let active = true
    const unsubscribe = api.onSettingsSection(value => {
      if (active) setSection(value === 'updates' ? 'updates' : 'notifications')
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  /** Show the transient "saved" confirmation, replacing any previous timer. */
  const flashSaved = useCallback((): void => {
    setSaved(true)
  }, [])

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 1200)
    return () => clearTimeout(timer)
  }, [saved])

  const saveNotifications = useCallback(async (next: NotificationPreferences): Promise<void> => {
    const stored = await shellBridge().updateNotificationPreferences(next) as NotificationPreferences
    // Echo-back: the stored value is the truth, not the value we sent.
    setNotifications(stored)
    flashSaved()
  }, [flashSaved])

  const savePolicy = useCallback(async (next: UpdatePolicy): Promise<void> => {
    const stored = await shellBridge().updateUpdatePreferences({ policy: next }) as { policy: UpdatePolicy }
    setPolicy(stored.policy)
    // Deliberately the SAME slot the update-state message uses. The original
    // overwrote one line for both, and the next state render replaces this text.
    setFeedbackOverride(localize(locale, '更新策略已保存。', 'Update policy saved.'))
  }, [locale])

  const runUpdateAction = useCallback(async (action: 'check' | 'download' | 'install'): Promise<void> => {
    const next = await shellBridge().desktopUpdateAction(action) as UpdateSnapshot | undefined
    if (next !== undefined) setUpdate(next)
  }, [])

  /**
   * Escape closes the window unless a listbox is open.
   *
   * The Listbox primitive calls `preventDefault()` on its own Escape, so this
   * handler can rely on `defaultPrevented` rather than querying the DOM for an
   * open listbox — the original's selector-based check, expressed without the
   * DOM query.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      void shellBridge().closeDesktopSettings()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  if (bootstrap === undefined) return null

  const zh = isZhLocale(locale)
  const view = updateView(locale, update)
  const selectChevron = './shell-icons/chevron-down.svg'

  return (
    <div className="settings-layout">
      <aside aria-label={localize(locale, '设置分类', 'Settings categories')}>
        <p className="eyebrow">{localize(locale, '桌面端', 'Desktop')}</p>
        <button
          type="button"
          className="nav-item"
          aria-current={section === 'notifications' ? 'page' : undefined}
          onClick={() => setSection('notifications')}
        >
          {localize(locale, '通知', 'Notifications')}
        </button>
        <button
          type="button"
          className="nav-item"
          aria-current={section === 'updates' ? 'page' : undefined}
          onClick={() => setSection('updates')}
        >
          {localize(locale, '更新', 'Updates')}
        </button>
      </aside>

      <main>
        <div className="content">
          <section className="page" hidden={section !== 'notifications'} aria-label={localize(locale, '通知', 'Notifications')}>
            <h1>{localize(locale, '通知', 'Notifications')}</h1>
            <div className="group">
              <div className="row">
                <span>
                  <span className="label" id="turnLabel">{localize(locale, '任务完成通知', 'Task completion notifications')}</span>
                  <span className="description">
                    {localize(locale, '设置 DeepSeek Harness 完成任务时何时提醒你', "Set when DeepSeek Harness alerts you that it's finished")}
                  </span>
                </span>
                <Listbox
                  labelId="turnLabel"
                  options={completionOptions(locale)}
                  value={notifications.turnMode}
                  chevronSrc={selectChevron}
                  onChange={turnMode => { void saveNotifications({ ...notifications, turnMode }) }}
                />
              </div>
              <SwitchRow
                id="approvalsEnabled"
                labelId="approvalLabel"
                title={localize(locale, '审批通知', 'Approval notifications')}
                description={localize(locale, '需要你审批权限或计划时显示提醒', 'Show alerts when permissions or plans require your approval')}
                checked={notifications.approvalsEnabled}
                onChange={approvalsEnabled => { void saveNotifications({ ...notifications, approvalsEnabled }) }}
              />
              <SwitchRow
                id="questionsEnabled"
                labelId="questionLabel"
                title={localize(locale, '问题通知', 'Question notifications')}
                description={localize(locale, '任务需要你的输入才能继续时显示提醒', 'Show alerts when input is needed to continue')}
                checked={notifications.questionsEnabled}
                onChange={questionsEnabled => { void saveNotifications({ ...notifications, questionsEnabled }) }}
              />
            </div>
            <div className={`status-line${saved ? ' visible' : ''}`} role="status" aria-live="polite">
              {localize(locale, '已保存', 'Saved')}
            </div>
          </section>

          <section className="page" hidden={section !== 'updates'} aria-label={localize(locale, '更新', 'Updates')}>
            <h1>{localize(locale, '更新', 'Updates')}</h1>
            <div className="group">
              <div className="row">
                <span>
                  <span className="label" id="policyLabel">{localize(locale, '自动更新', 'Automatic updates')}</span>
                  <span className="description">
                    {localize(
                      locale,
                      '选择桌面端如何检查和下载新版本。安装前始终由你确认。',
                      'Choose how the desktop app checks for and downloads new versions. Installation always requires your confirmation.',
                    )}
                  </span>
                </span>
                <Listbox
                  labelId="policyLabel"
                  options={policyOptions(locale)}
                  value={policy}
                  chevronSrc={selectChevron}
                  onChange={next => { void savePolicy(next) }}
                />
              </div>
              <div className="version-block">
                <div>
                  <span className="label">{localize(locale, '当前版本', 'Current version')}</span>
                  <span className="version">{update.currentVersion || '—'}</span>
                  <span className="description">{formatChecked(locale, update.lastCheckedAt)}</span>
                </div>
                <span className={`badge ${view.badgeKind}`}>{view.badge}</span>
              </div>
              <div className="row">
                <span>
                  <span className="label">{localize(locale, '桌面端更新', 'Desktop updates')}</span>
                  <span className="description">
                    {localize(locale, '检查 GitHub Releases 中适用于当前系统的新版本。', 'Check GitHub Releases for a new version compatible with this system.')}
                  </span>
                </span>
                <button
                  type="button"
                  className="update-action"
                  disabled={view.disabled}
                  onClick={() => { void runUpdateAction(view.action) }}
                >
                  {view.actionLabel}
                </button>
              </div>
            </div>
            {view.releaseNotes !== undefined && view.releaseNotes !== '' ? (
              <div className="notes">
                <p className="notes-title">{localize(locale, '版本说明', 'Release notes')}</p>
                <pre className="notes-body">{view.releaseNotes}</pre>
              </div>
            ) : null}
            <p className={`update-feedback${view.feedbackIsError ? ' error' : ''}`} role="status" aria-live="polite">
              {feedbackOverride !== '' ? feedbackOverride : view.feedback}
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
