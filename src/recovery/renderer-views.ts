/**
 * Renderer-safe projections for the recovery page.
 *
 * WHY A PROJECTION LAYER AT ALL
 * -----------------------------
 * The recovery page is sandboxed: no filesystem, no `node:` imports, no network.
 * Everything it knows arrives through IPC. Handing it the internal shapes directly
 * would leak filesystem paths and couple the page to storage details it has no
 * business knowing — so the shapes crossing the boundary are defined here, once.
 *
 * The two rules this module enforces:
 *
 *   1. **No absolute paths.** The page describes a checkpoint ("slot 2, captured at
 *      X, 7 files"); it never needs to know where that lives.
 *   2. **Tolerance is preserved.** Stage 3 made a corrupt slot read as empty so one
 *      bad file cannot hide the other recovery points. That property has to survive
 *      the projection, or the page would lose every slot because of one bad manifest.
 */
import type { DesktopProfileCheckpointSlotId, ProfileCheckpointSlot } from './profile-checkpoint.js'

/** One checkpoint slot as the page sees it. */
export interface ProjectedCheckpointSlot {
  readonly slotId: DesktopProfileCheckpointSlotId
  readonly status: 'empty' | 'available'
  /** ISO capture time; absent for an empty slot. */
  readonly capturedAt?: string
  readonly appVersion?: string
  readonly fileCount?: number
  readonly totalBytes?: number
}

/** One managed profile as the page sees it. */
export interface ProjectedProfile {
  readonly name: string
  readonly current: boolean
  readonly selectable: boolean
  readonly deletable: boolean
  readonly exists: boolean
  readonly webCapable: boolean
  readonly problem: string | null
}

/**
 * Project checkpoint slots for the renderer.
 *
 * `profileName` is deliberately NOT included: the page already knows which profile
 * it is recovering (it is shown in the reason card), and repeating it in every slot
 * would be noise.
 */
export function projectCheckpointSlots(slots: readonly ProfileCheckpointSlot[]): readonly ProjectedCheckpointSlot[] {
  return slots.map(slot => {
    if (!slot.snapshotExists || slot.manifest === undefined) {
      return { slotId: slot.slotId, status: 'empty' }
    }
    const { manifest } = slot
    // `fileCount` counts the RECORDED entries, including ones recorded as absent —
    // that is the number of files the checkpoint governs, which is what the page
    // should report. Summing only the present ones would understate it.
    const totalBytes = manifest.files.reduce((sum, file) => sum + (file.present ? file.size ?? 0 : 0), 0)
    return {
      slotId: slot.slotId,
      status: 'available',
      capturedAt: manifest.capturedAt,
      appVersion: manifest.appVersion,
      fileCount: manifest.files.length,
      totalBytes,
    }
  })
}

/**
 * Project managed profiles for the renderer.
 *
 * Order is preserved rather than sorted: the caller lists the active profile first
 * so the page can render it as such without a second pass.
 */
export function projectProfileViews(profiles: readonly ProjectedProfile[]): readonly ProjectedProfile[] {
  return profiles.map(profile => ({
    name: profile.name,
    current: profile.current,
    selectable: profile.selectable,
    // The backend refuses to delete the active profile; surfacing the flag keeps
    // that rule in one place instead of duplicating it in the UI.
    deletable: profile.deletable,
    exists: profile.exists,
    webCapable: profile.webCapable,
    problem: profile.problem,
  }))
}
