/**
 * Desktop settings section — 文案与结构 1:1 对齐 dsh-desktop（dsh-plugin-desktop）。
 *
 * 文案键来自 `./desktop-settings-locales.ts`（与 dsh-desktop 的 desktop-settings-locales.ts
 * 逐字一致）。数据面仍走本插件自己的 `/api/dsh-my-settings` 契约，宿主能力缺失时按 capability 降级。
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  DesktopSettingsApi,
  DesktopSettingsError,
  DesktopSettingsView,
  SettingsCapabilityToken,
  SettingsCapabilityView,
  SettingsMarketProvider,
  SettingsNotificationsUpdateRequest,
} from './desktop-settings-api.ts'
import type { DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'

/** Browser view of the Host `dsh-desktop` settings namespace (registry surface). */
export interface DesktopShellSettings {
  readonly mode: 'compatibility' | 'extended' | 'advanced'
  readonly material: 'off' | 'mica' | 'acrylic' | 'transparent'
}

/** Browser view of the Host `dsh-desktop-notifications` settings namespace (registry surface). */
export interface DesktopNotificationSettings {
  readonly enabled: boolean
  readonly sessionEnd: boolean
  readonly errors: boolean
  readonly updates: boolean
  readonly progress: boolean
}

/** Registration-side business face for the Desktop settings section. */
export interface DesktopSettingsSectionInjected {
  readonly api: DesktopSettingsApi
  /** `dsh-desktop` namespace binding (registry surface; the renderer uses `api`). */
  readonly desktopSettings?: SettingsScope<DesktopShellSettings>
  /** `dsh-desktop-notifications` namespace binding (registry surface). */
  readonly notificationSettings?: SettingsScope<DesktopNotificationSettings>
}

/** Renderer-composed props for the official settings section entry. */
export type DesktopSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'desktop.settings'>
  & InjectFace<DesktopSettingsSectionInjected>

type Translate = DesktopSettingsSectionProps['t']
type BusyOperation = 'load' | 'market' | 'aa' | 'notifications' | 'appearance' | 'host-action' | 'create-profile' | 'select-profile' | 'delete-profile'
type RestartState = 'none' | 'restarting' | 'required'

/** Host-专属 side-effect tokens rendered as action buttons. */
const HOST_ACTION_TOKENS: readonly {
  token: Exclude<SettingsCapabilityToken, 'profile.discover' | 'market.preference' | 'aa.preference' | 'notifications.preference' | 'appearance.preference' | 'host.profile-switch' | 'host.web-and-material'>
  label: DesktopSettingsLocaleKey
  busyLabel: DesktopSettingsLocaleKey
}[] = [
  { token: 'host.restart', label: 'restartDesktop', busyLabel: 'restartingDesktop' },
  { token: 'host.open-terminal', label: 'openTerminal', busyLabel: 'openingTerminal' },
  { token: 'host.devtools', label: 'toggleDeveloperTools', busyLabel: 'toggleDeveloperTools' },
  { token: 'host.diagnostics-export', label: 'exportDiagnostics', busyLabel: 'exportingDiagnostics' },
]

const MARKET_OPTIONS: readonly {
  id: SettingsMarketProvider
  title: DesktopSettingsLocaleKey
  body: DesktopSettingsLocaleKey
}[] = [
  { id: 'disabled', title: 'marketDisabled', body: 'marketDisabledBody' },
  { id: 'community-market', title: 'communityMarket', body: 'communityMarketBody' },
  { id: 'dsh-market', title: 'dshMarket', body: 'dshMarketBody' },
]

const MATERIALS: readonly { value: DesktopSettingsView['appearance']['material']; label: DesktopSettingsLocaleKey }[] = [
  { value: 'off', label: 'windowMaterialOff' },
  { value: 'transparent', label: 'windowMaterialTransparent' },
  { value: 'mica', label: 'windowMaterialMica' },
]

const MODES: readonly { value: DesktopSettingsView['appearance']['mode']; label: DesktopSettingsLocaleKey; body: DesktopSettingsLocaleKey }[] = [
  { value: 'compatibility', label: 'compatibilityMode', body: 'compatibilityModeBody' },
  { value: 'extended', label: 'extendedMode', body: 'extendedModeBody' },
  { value: 'advanced', label: 'advancedMode', body: 'advancedModeBody' },
]

function capabilityOf(view: DesktopSettingsView, token: SettingsCapabilityToken): SettingsCapabilityView | undefined {
  return view.capabilities.find(item => item.token === token)
}

function profileState(profile: DesktopSettingsView['host']['profiles'][number], t: Translate): string {
  const usable = profile.exists !== false && profile.webCapable !== false
  return t(usable ? 'profileReady' : 'profileUnavailable')
}

function Choice({
  title,
  body,
  selected,
  disabled,
  action,
  status,
  aside,
}: {
  title: ReactNode
  body: ReactNode
  selected: boolean
  disabled: boolean
  action: () => void
  status?: ReactNode
  aside?: ReactNode
}) {
  const actionable = !disabled && !selected
  const choose = (): void => {
    if (actionable) action()
  }
  return (
    <div
      role="radio"
      className="dshDesktopSettingsChoice"
      data-selected={selected ? 'true' : undefined}
      data-actionable={actionable ? 'true' : undefined}
      aria-checked={selected}
      aria-disabled={disabled ? 'true' : undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={choose}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        choose()
      }}
    >
      <span className="dshDesktopSettingsChoiceCopy">
        <span className="dshDesktopSettingsChoiceTitle">
          {title}
          {status !== undefined && <span className="dshDesktopSettingsBadge">{status}</span>}
        </span>
        <span className="dshDesktopSettingsChoiceBody">{body}</span>
      </span>
      {aside}
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: ReactNode
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="dshDesktopSettingsToggleRow">
      <span className="dshDesktopSettingsToggleLabel">{label}</span>
      <button
        type="button"
        role="switch"
        className="dshDesktopSettingsToggle"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => { onChange(!checked) }}
      >
        <span className="dshDesktopSettingsToggleKnob" aria-hidden="true" />
      </button>
    </div>
  )
}

/** Render the Desktop settings page. */
export function DesktopSettingsSection({ t, api }: DesktopSettingsSectionProps) {
  const [view, setView] = useState<DesktopSettingsView>()
  const [busy, setBusy] = useState<BusyOperation | undefined>('load')
  const [loadFailed, setLoadFailed] = useState(false)
  const [operationError, setOperationError] = useState<DesktopSettingsError | null>(null)
  const [activeHostToken, setActiveHostToken] = useState<SettingsCapabilityToken>()
  const [restart, setRestart] = useState<RestartState>('none')
  const [profileName, setProfileName] = useState('')
  const [pendingProfileDelete, setPendingProfileDelete] = useState<string>()

  const refresh = useCallback(async (): Promise<void> => {
    const next = await api.read()
    setView(next)
    // A pending delete-confirm is transient UI state keyed by profile name.
    // Drop it on every refresh so a profile re-created with the same name never
    // inherits the delete-confirmation styling of the one deleted before it.
    setPendingProfileDelete(undefined)
  }, [api])

  const load = useCallback(async () => {
    setBusy('load')
    setLoadFailed(false)
    setOperationError(null)
    try {
      await refresh()
    } catch {
      setLoadFailed(true)
    } finally {
      setBusy(current => current === 'load' ? undefined : current)
    }
  }, [refresh])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (restart !== 'restarting') return
    const timer = setTimeout(() => { setRestart('required') }, 8_000)
    return () => { clearTimeout(timer) }
  }, [restart])

  const requestRestart = (): void => { setRestart('restarting') }

  const run = useCallback(async (operation: BusyOperation, invoke: () => Promise<void>) => {
    setBusy(operation)
    setOperationError(null)
    try {
      await invoke()
    } catch (error) {
      if (isDesktopSettingsError(error)) setOperationError(error)
      else setOperationError(null)
    } finally {
      setBusy(current => current === operation ? undefined : current)
    }
  }, [])

  const persistAndRefresh = async (invoke: () => Promise<void>): Promise<void> => {
    await invoke()
    await refresh()
  }

  /**
   * Refresh again shortly after a profile write. The launcher performs create/
   * delete in the Electron main process; the first refresh can race the write,
   * so a short follow-up guarantees the list reflects the new state even if the
   * request round-trip lagged.
   */
  const scheduleDelayedRefresh = (delaysMs: readonly number[] = [400]): void => {
    for (const delay of delaysMs) {
      window.setTimeout(() => { void refresh().catch(() => undefined) }, delay)
    }
  }

  const createProfile = (event: FormEvent): void => {
    event.preventDefault()
    const name = profileName.trim()
    if (name.length === 0) return
    void run('create-profile', async () => {
      // Schedule follow-up refreshes BEFORE awaiting: the launcher performs the
      // create in the main process (seeding a new profile can take seconds), and
      // the list must reflect it even if the request round-trip is slow.
      scheduleDelayedRefresh([600, 2_500, 6_000])
      await api.createProfile(name)
      setProfileName('')
      await refresh()
    })
  }

  const selectProfile = (name: string): void => {
    void run('select-profile', async () => {
      const acceptance = await api.selectProfile(name)
      if (acceptance.restartRequired) requestRestart()
    })
  }

  const deleteProfile = (name: string): void => {
    void run('delete-profile', async () => {
      scheduleDelayedRefresh([600, 2_500])
      await api.deleteProfile(name)
      setPendingProfileDelete(undefined)
      await refresh()
    })
  }

  const selectMarket = (provider: SettingsMarketProvider): void => {
    void run('market', () => persistAndRefresh(async () => {
      const acceptance = await api.selectMarket(provider)
      if (acceptance.restartRequired) requestRestart()
    }))
  }

  const selectAa = (enabled: boolean): void => {
    void run('aa', () => persistAndRefresh(async () => {
      const acceptance = await api.selectAa(enabled)
      if (acceptance.restartRequired) requestRestart()
    }))
  }

  const updateNotification = (request: SettingsNotificationsUpdateRequest): void => {
    void run('notifications', () => persistAndRefresh(() => api.updateNotifications(request)))
  }

  const updateAppearance = (update: { material?: DesktopSettingsView['appearance']['material']; mode?: DesktopSettingsView['appearance']['mode'] }): void => {
    void run('appearance', () => persistAndRefresh(() => api.updateAppearance(update)))
  }

  const performHostAction = (token: (typeof HOST_ACTION_TOKENS)[number]['token']): void => {
    setActiveHostToken(token)
    void run('host-action', () => api.performHostAction(token)).then(() => { setActiveHostToken(undefined) })
  }

  const disabled = busy !== undefined || restart !== 'none'
  const marketCapability = view ? capabilityOf(view, 'market.preference') : undefined
  const aaCapability = view ? capabilityOf(view, 'aa.preference') : undefined
  const notificationsCapability = view ? capabilityOf(view, 'notifications.preference') : undefined
  const appearanceCapability = view ? capabilityOf(view, 'appearance.preference') : undefined
  const switchCapability = view ? capabilityOf(view, 'host.profile-switch') : undefined

  const hostActionCapability = (token: SettingsCapabilityToken): SettingsCapabilityView | undefined => (
    view ? capabilityOf(view, token) : undefined
  )

  const marketEnabled = marketCapability?.supported !== false
  const aaEnabled = aaCapability?.supported !== false
  const appearanceEnabled = appearanceCapability?.supported !== false
  const notificationsEnabled = notificationsCapability?.supported !== false
  const profileManagementEnabled = switchCapability?.supported === true

  return (
    <div className="dshDesktopSettings">
      <header className="dshDesktopSettingsHeader">
        <h2>{t('title')}</h2>
        <p>{t('intro')}</p>
      </header>

      {operationError !== null && <p className="dshDesktopSettingsError" role="alert">{t('operationFailed')}</p>}
      {restart !== 'none' && (
        <p className="dshDesktopSettingsSuccess" role="status">
          {t(restart === 'restarting' ? 'restarting' : 'restartRequired')}
        </p>
      )}

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-profile-title">
        <div>
          <h3 id="dsh-desktop-profile-title">{t('profileTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('profileIntro')}</p>
        </div>
        {busy === 'load' && view === undefined && <p className="dshDesktopSettingsHint">{t('loading')}</p>}
        {loadFailed && view === undefined && (
          <div>
            <p className="dshDesktopSettingsError" role="alert">{t('unavailable')}</p>
            <button type="button" className="dshDesktopSettingsButton" onClick={() => { void load() }}>{t('retry')}</button>
          </div>
        )}
        {view !== undefined && (
          <>
            <div className="dshDesktopSettingsList" role="radiogroup" aria-labelledby="dsh-desktop-profile-title">
              {view.host.profiles.map((profile) => {
                const current = profile.current
                const deleteAction = profileManagementEnabled && profile.deletable === true && !current && busy === undefined && restart === 'none'
                  ? (
                    <div className="dshDesktopSettingsChoiceAside" onClick={event => { event.stopPropagation() }}>
                      {pendingProfileDelete === profile.name ? (
                        <div className="dshDesktopSettingsDeleteConfirm" role="group" aria-label={t('confirmDeleteProfile')}>
                          <span className="dshDesktopSettingsDeleteWarning">{t('deleteProfileWarning')}</span>
                          <span className="dshDesktopSettingsDeleteActions">
                            <button
                              type="button"
                              className="dshDesktopSettingsButton dshDesktopSettingsButtonDanger"
                              disabled={busy !== undefined}
                              onClick={() => { deleteProfile(profile.name) }}
                            >
                              {busy === 'delete-profile' ? t('deletingProfile') : t('confirmDeleteProfile')}
                            </button>
                            <button
                              type="button"
                              className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary"
                              disabled={busy !== undefined}
                              onClick={() => { setPendingProfileDelete(undefined) }}
                            >
                              {t('cancelDeleteProfile')}
                            </button>
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="dshDesktopSettingsButton dshDesktopSettingsButtonSecondary"
                          onClick={() => { setPendingProfileDelete(profile.name) }}
                        >
                          {t('deleteProfile')}
                        </button>
                      )}
                    </div>
                  ) : undefined
                return (
                  <Choice
                    key={profile.name}
                    title={profile.name}
                    body={profileState(profile, t)}
                    selected={current}
                    disabled={!profileManagementEnabled || profile.selectable === false || busy !== undefined || restart !== 'none'}
                    action={() => { selectProfile(profile.name) }}
                    status={current ? t('activeProfile') : undefined}
                    aside={deleteAction}
                  />
                )
              })}
            </div>
            {profileManagementEnabled && (
              <form className="dshDesktopSettingsForm" onSubmit={createProfile}>
                <label className="dshDesktopSettingsField">
                  {t('profileName')}
                  <input
                    className="dshDesktopSettingsInput"
                    value={profileName}
                    maxLength={128}
                    autoComplete="off"
                    placeholder={t('profileNamePlaceholder')}
                    disabled={busy !== undefined || restart !== 'none'}
                    onChange={event => { setProfileName(event.currentTarget.value) }}
                  />
                </label>
                <button
                  type="submit"
                  className="dshDesktopSettingsButton"
                  disabled={profileName.trim().length === 0 || busy !== undefined || restart !== 'none'}
                >
                  {busy === 'create-profile' ? t('creatingProfile') : t('create')}
                </button>
              </form>
            )}
          </>
        )}
      </section>

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-market-title">
        <div>
          <h3 id="dsh-desktop-market-title">{t('marketTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('marketIntro')}</p>
        </div>
        {view?.market.legacyDefaulted === true && <p className="dshDesktopSettingsNotice">{t('legacyMarketNotice')}</p>}
        {view !== undefined && view.market.requested !== view.market.effective && restart === 'none' && (
          <p className="dshDesktopSettingsNotice" role="status">{t('marketLoadFailed')}</p>
        )}
        {view !== undefined && (
          <div className="dshDesktopSettingsList" role="radiogroup" aria-labelledby="dsh-desktop-market-title">
            {MARKET_OPTIONS.map(option => (
              <Choice
                key={option.id}
                title={t(option.title)}
                body={t(option.body)}
                selected={view.market.requested === option.id}
                disabled={!marketEnabled || disabled}
                action={() => { selectMarket(option.id) }}
                status={view.market.requested === option.id && view.market.requested !== view.market.effective
                  ? t('retryMarket')
                  : view.market.requested === option.id ? t('selected') : undefined}
              />
            ))}
          </div>
        )}
      </section>

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-aa-title">
        <div>
          <h3 id="dsh-desktop-aa-title">{t('aaTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('aaIntro')}</p>
        </div>
        {view !== undefined && view.aa.requested === true && !view.aa.effective && restart === 'none' && (
          <p className="dshDesktopSettingsNotice" role="status">{t('aaLoadFailed')}</p>
        )}
        {view !== undefined && (
          <div className="dshDesktopSettingsList" role="radiogroup" aria-labelledby="dsh-desktop-aa-title">
            {[false, true].map(enabled => (
              <Choice
                key={String(enabled)}
                title={t(enabled ? 'aaEnabled' : 'aaDisabled')}
                body={t(enabled ? 'aaEnabledBody' : 'aaDisabledBody')}
                selected={(view.aa.requested ?? false) === enabled}
                disabled={!aaEnabled || disabled}
                action={() => { selectAa(enabled) }}
                status={(view.aa.requested ?? false) === enabled ? t('selected') : undefined}
              />
            ))}
          </div>
        )}
      </section>

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-presentation-title">
        <div>
          <h3 id="dsh-desktop-presentation-title">{t('presentationTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('presentationIntro')}</p>
        </div>
        {view !== undefined && (
          <>
            <div className="dshDesktopSettingsList" role="radiogroup" aria-labelledby="dsh-desktop-presentation-title">
              {MODES.map(mode => (
                <Choice
                  key={mode.value}
                  title={t(mode.label)}
                  body={t(mode.body)}
                  selected={view.appearance.mode === mode.value}
                  disabled={!appearanceEnabled || disabled}
                  action={() => { updateAppearance({ mode: mode.value }) }}
                  status={view.appearance.mode === mode.value ? t('selected') : undefined}
                />
              ))}
            </div>
            <label className="dshDesktopSettingsMaterialField">
              <span className="dshDesktopSettingsMaterialCopy">
                <span className="dshDesktopSettingsChoiceTitle">{t('windowMaterial')}</span>
                <span className="dshDesktopSettingsChoiceBody">{t('windowMaterialBody')}</span>
              </span>
              <select
                className="dshDesktopSettingsSelect"
                value={view.appearance.material}
                disabled={!appearanceEnabled || disabled}
                onChange={event => { updateAppearance({ material: event.currentTarget.value as DesktopSettingsView['appearance']['material'] }) }}
              >
                {MATERIALS.map(material => (
                  <option key={material.value} value={material.value}>{t(material.label)}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </section>

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-notifications-title">
        <div>
          <h3 id="dsh-desktop-notifications-title">{t('notificationsTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('notificationsIntro')}</p>
        </div>
        {view !== undefined && (
          <>
            <ToggleRow
              label={t('notificationsEnabled')}
              checked={view.notifications.enabled}
              disabled={!notificationsEnabled || disabled}
              onChange={checked => { updateNotification({ enabled: checked, events: view.notifications.events }) }}
            />
            <div className="dshDesktopSettingsDetails">
              <ToggleRow
                label={t('turnCompletion')}
                checked={view.notifications.events.sessionEnd}
                disabled={!view.notifications.enabled || !notificationsEnabled || disabled}
                onChange={checked => { updateNotification({ enabled: view.notifications.enabled, events: { ...view.notifications.events, sessionEnd: checked } }) }}
              />
              <ToggleRow
                label={t('turnFailure')}
                checked={view.notifications.events.errors}
                disabled={!view.notifications.enabled || !notificationsEnabled || disabled}
                onChange={checked => { updateNotification({ enabled: view.notifications.enabled, events: { ...view.notifications.events, errors: checked } }) }}
              />
              <ToggleRow
                label={t('jobCompletion')}
                checked={view.notifications.events.updates}
                disabled={!view.notifications.enabled || !notificationsEnabled || disabled}
                onChange={checked => { updateNotification({ enabled: view.notifications.enabled, events: { ...view.notifications.events, updates: checked } }) }}
              />
              <ToggleRow
                label={t('jobFailure')}
                checked={view.notifications.events.progress}
                disabled={!view.notifications.enabled || !notificationsEnabled || disabled}
                onChange={checked => { updateNotification({ enabled: view.notifications.enabled, events: { ...view.notifications.events, progress: checked } }) }}
              />
            </div>
          </>
        )}
      </section>

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-host-actions-title">
        <div>
          <h3 id="dsh-desktop-host-actions-title">{t('developerOptions')}</h3>
        </div>
        <div className="dshDesktopSettingsList">
          {HOST_ACTION_TOKENS.map(({ token, label, busyLabel }) => {
            const capability = hostActionCapability(token)
            const supported = capability?.supported === true
            const running = busy === 'host-action' && activeHostToken === token
            return (
              <div key={token} className="dshDesktopSettingsChoice dshDesktopSettingsChoiceStatic">
                <span className="dshDesktopSettingsChoiceCopy">
                  <span className="dshDesktopSettingsChoiceTitle">{t(label)}</span>
                </span>
                <button
                  type="button"
                  className="dshDesktopSettingsButton"
                  disabled={!supported || disabled}
                  onClick={() => { performHostAction(token) }}
                >
                  {running ? t(busyLabel) : t(label)}
                </button>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function isDesktopSettingsError(value: unknown): value is DesktopSettingsError {
  return typeof value === 'object' && value !== null
    && 'kind' in value && 'message' in value && 'code' in value
}
