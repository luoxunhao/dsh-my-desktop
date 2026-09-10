/**
 * Typed access to the recovery page's IPC surface.
 *
 * WHY A WRAPPER RATHER THAN CALLING `window.dshRecovery` DIRECTLY
 * --------------------------------------------------------------
 * Two reasons:
 *
 * 1. The preload exposes a plain object of functions with no types. Declaring the
 *    shapes here means the panels get compile-time checking against the contract the
 *    main process actually implements.
 * 2. The bridge may be ABSENT — if the page is opened outside the app (during
 *    development, or in a plain browser), `window.dshRecovery` is undefined. Every
 *    call goes through one guard rather than each panel inventing its own.
 *
 * The channel list is deliberately NOT generic: the preload publishes a fixed set of
 * operations, so a compromised page cannot reach arbitrary IPC. This module mirrors
 * that set exactly.
 */

/** One checkpoint slot as the main process projects it. */
export interface RecoveryCheckpointSlot {
  readonly slotId: 'slot-1' | 'slot-2' | 'slot-3'
  readonly status: 'empty' | 'available'
  readonly capturedAt?: string
  readonly appVersion?: string
  readonly fileCount?: number
  readonly totalBytes?: number
}

/** Result of comparing a slot against what is currently on disk. */
export interface RecoveryCheckpointInspection {
  readonly slotId: string
  readonly snapshotExists: boolean
  readonly currentDiffers: boolean
  readonly changedFiles: readonly string[]
}

/** One managed profile. */
export interface RecoveryProfile {
  readonly name: string
  readonly current: boolean
  readonly selectable: boolean
  readonly deletable: boolean
  readonly exists: boolean
  readonly webCapable: boolean
  readonly problem: string | null
}

/** One isolated plugin. */
export interface RecoveryPlugin {
  readonly packageName: string
}

/** The status projection the page renders its reason card and panels from. */
export interface RecoveryStatus {
  readonly active: boolean
  readonly isolated: readonly RecoveryPlugin[]
  readonly running: boolean
  readonly pendingRestore?: readonly string[]
  readonly suspectedPlugin?: string
  readonly failureMessage?: string
  readonly candidates?: readonly { readonly packageName: string }[]
  readonly checkpoint?: unknown
  readonly diagnostic?: unknown
}

/** The recovery page's preload surface. Absent when the page runs outside the app. */
interface RecoveryBridge {
  activate: () => Promise<RecoveryStatus>
  getStatus: () => Promise<RecoveryStatus>
  keepIsolated: (packageName: string) => Promise<RecoveryStatus>
  getStartupLog: () => Promise<string>
  restore: (packageName: string) => Promise<RecoveryStatus>
  restoreHealthyConfig: () => Promise<RecoveryStatus>
  returnToWorkbench: () => Promise<void>
  uninstall: (packageName: string) => Promise<RecoveryStatus>
  listCheckpoints: () => Promise<readonly RecoveryCheckpointSlot[]>
  inspectCheckpoint: (slotId: string) => Promise<RecoveryCheckpointInspection>
  listProfiles: () => Promise<readonly RecoveryProfile[]>
}

declare global {
  interface Window {
    readonly dshRecovery?: RecoveryBridge
  }
}

/** Thrown when the page has no bridge — i.e. it is not running inside the app. */
export class RecoveryBridgeUnavailableError extends Error {
  constructor() {
    super('恢复通道不可用：本页面未运行在应用内。')
    this.name = 'RecoveryBridgeUnavailableError'
  }
}

/** The bridge, or a thrown error explaining why it is missing. */
export function requireBridge(): RecoveryBridge {
  const bridge = window.dshRecovery
  if (bridge === undefined) throw new RecoveryBridgeUnavailableError()
  return bridge
}

/** Whether the page is running with a usable bridge. */
export function hasBridge(): boolean {
  return window.dshRecovery !== undefined
}

export const recoveryApi = {
  status: (): Promise<RecoveryStatus> => requireBridge().getStatus(),
  activate: (): Promise<RecoveryStatus> => requireBridge().activate(),
  keepIsolated: (packageName: string): Promise<RecoveryStatus> => requireBridge().keepIsolated(packageName),
  getStartupLog: (): Promise<string> => requireBridge().getStartupLog(),
  restore: (packageName: string): Promise<RecoveryStatus> => requireBridge().restore(packageName),
  restoreHealthyConfig: (): Promise<RecoveryStatus> => requireBridge().restoreHealthyConfig(),
  returnToWorkbench: (): Promise<void> => requireBridge().returnToWorkbench(),
  uninstall: (packageName: string): Promise<RecoveryStatus> => requireBridge().uninstall(packageName),
  listCheckpoints: (): Promise<readonly RecoveryCheckpointSlot[]> => requireBridge().listCheckpoints(),
  inspectCheckpoint: (slotId: string): Promise<RecoveryCheckpointInspection> => requireBridge().inspectCheckpoint(slotId),
  listProfiles: (): Promise<readonly RecoveryProfile[]> => requireBridge().listProfiles(),
}
