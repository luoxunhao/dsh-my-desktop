/**
 * Where the desktop shell keeps its two preference files.
 *
 * WHY THESE LIVE HERE AND NOT IN THE SERVICES
 * -------------------------------------------
 * The services need the *loaded* preferences to be constructed, and loading needs
 * these paths — so the paths cannot live inside the services without a cycle:
 *
 *     createNotificationService({ preferences }) needs loadPreferences(path)
 *     loadPreferences(path) needs the service to ask for the path   ← cycle
 *
 * Extracting the paths into a leaf module that imports nothing but `electron` lets
 * startup resolve them first, load both files, and only then build the services.
 * This was found by a real startup crash (`通知服务尚未初始化。`), not by inspection.
 */
import { app } from 'electron'
import { join } from 'node:path'

/** Preferences file for desktop notifications. */
export function notificationPreferencesPath(): string {
  return join(app.getPath('userData'), 'desktop-settings.json')
}

/** Preferences file for the desktop update policy. */
export function updatePreferencesPath(): string {
  return join(app.getPath('userData'), 'desktop-update-settings.json')
}
