/**
 * The fixed set of recovery actions the page may request.
 *
 * WHY AN ALLOWLIST RATHER THAN A CHANNEL-PER-ACTION
 * -------------------------------------------------
 * The recovery page is sandboxed. If it could name arbitrary operations, a
 * compromised or merely buggy page would reach every handler in the main process.
 * Publishing a fixed vocabulary — and rejecting anything outside it — bounds the
 * surface to what someone deliberately listed here.
 *
 * It also gives the page ONE call shape (`perform(action, payload)`), which keeps
 * the preload small and the IPC contract reviewable in a single file.
 */

/** Actions that take no payload. */
const NULLARY_ACTIONS = [
  'activate',
  'keep-isolated',
  'return-to-workbench',
  'startup-log',
  'list-checkpoints',
  'list-profiles',
  'data-directory',
  'factory-reset',
  'enter-safe-mode',
  'export-diagnostics',
  'show-diagnostics',
  'switch-profile',
  'create-profile',
] as const

/** Actions whose payload is a name (plugin or slot). */
const PAYLOAD_ACTIONS = [
  'uninstall',
  'restore',
  'inspect-checkpoint',
  'restore-checkpoint',
  'select-data-directory',
  'switch-profile',
  'create-profile',
] as const

/** Opening a configuration file or directory in the OS. */
export const OPEN_TARGET_ACTIONS = [
  'settings-document',
  'profile-patch',
  'profile-manifest',
  'profile-directory',
] as const

/** Data-directory management. */
export const DATA_DIRECTORY_ACTIONS = [
  'data-directory',
  'select-data-directory',
] as const

/** Destructive reset — always behind a two-phase confirmation. */
export const FACTORY_RESET_ACTIONS = ['factory-reset'] as const

export type RecoveryActionId =
  | typeof NULLARY_ACTIONS[number]
  | typeof PAYLOAD_ACTIONS[number]
  | typeof OPEN_TARGET_ACTIONS[number]

/** Every accepted action, for validation at the boundary. */
export const RECOVERY_ACTIONS: readonly RecoveryActionId[] = [
  ...NULLARY_ACTIONS,
  ...PAYLOAD_ACTIONS,
  ...OPEN_TARGET_ACTIONS,
]

/** Whether an untrusted string names a real action. */
export function isRecoveryAction(value: unknown): value is RecoveryActionId {
  return typeof value === 'string' && (RECOVERY_ACTIONS as readonly string[]).includes(value)
}
