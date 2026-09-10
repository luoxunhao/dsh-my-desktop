/**
 * dsh-my-desktop-setting client entry.
 *
 * Registers the shared `desktop.settings` locale dictionaries and the
 * `settings.section` page (DesktopSettingsSection). The section is driven by
 * the shared HTTP contract (`/api/dsh-my-settings`), and the `dsh-desktop` /
 * `dsh-desktop-notifications` settings namespaces are bound through the client
 * settings service so the page's own shell can discover/reflect them.
 *
 * @module dsh-my-desktop-setting/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DesktopSettingsSection,
  type DesktopNotificationSettings,
  type DesktopSettingsSectionInjected,
  type DesktopShellSettings,
} from './DesktopSettingsSection.tsx'
import { createDesktopSettingsApi } from './desktop-settings-api.ts'
import { en, zh, type DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'
import { installDesktopSettingsStyles } from './desktop-settings-styles.ts'

/** Locale namespace owned by the Desktop settings page. */
export const DESKTOP_SETTINGS_LOCALE_NAMESPACE = 'desktop.settings'

/** Host settings namespaces bound through the standard client settings service. */
export const DESKTOP_SHELL_SETTINGS_NAMESPACE = 'dsh-desktop'
export const DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE = 'dsh-desktop-notifications'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop settings page copy. */
    'desktop.settings': DesktopSettingsLocaleKey
  }
}

/** Services consumed by the Desktop settings surface. */
export const inject = ['slots', 'locale', 'settingsScope']

/** Register the Desktop settings page in the official Settings shell. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  const desktopSettings = ctx.settingsScope.bind<DesktopShellSettings>({
    namespace: DESKTOP_SHELL_SETTINGS_NAMESPACE,
  })
  const notificationSettings = ctx.settingsScope.bind<DesktopNotificationSettings>({
    namespace: DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE,
  })
  const api = createDesktopSettingsApi()
  const t = ctx.locale.bind(DESKTOP_SETTINGS_LOCALE_NAMESPACE)

  ctx.effect(
    () => ctx.locale.register(DESKTOP_SETTINGS_LOCALE_NAMESPACE, { zh, en }),
    'dsh-my-desktop-setting: settings dictionaries',
  )
  ctx.effect(
    () => installDesktopSettingsStyles(),
    'dsh-my-desktop-setting: settings styles',
  )
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'desktop-settings',
    order: 100,
    label: () => t('nav'),
    locale: DESKTOP_SETTINGS_LOCALE_NAMESPACE,
    inject: (): DesktopSettingsSectionInjected => ({
      api,
      desktopSettings,
      notificationSettings,
    }),
  }, DesktopSettingsSection))
}
