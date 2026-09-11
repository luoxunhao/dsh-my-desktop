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
  /**
   * Which profile this slot was captured from.
   *
   * KEPT ON PURPOSE. An earlier version of this projection dropped it as "noise",
   * reasoning that the page knows which profile it is recovering. That was wrong:
   * slots are per-profile on disk, the page aggregates them across ALL profiles, and
   * this field is the only thing that tells the user (and the restore call) where a
   * given slot came from. Rolling a desktop snapshot into the web profile is a
   * supported operation precisely because the slot carries its provenance.
   */
  readonly profileName: string
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
 * Slots arrive from EVERY profile (the page aggregates them), so each projected slot
 * carries the profile it came from — without it the page cannot tell two profiles'
 * slots apart, nor say where a restore would take its content from.
 */
export function projectCheckpointSlots(
  slots: readonly ProfileCheckpointSlot[],
  profileName: string,
): readonly ProjectedCheckpointSlot[] {
  return slots.map(slot => {
    if (!slot.snapshotExists || slot.manifest === undefined) {
      return { slotId: slot.slotId, status: 'empty', profileName }
    }
    const { manifest } = slot
    // `fileCount` counts the RECORDED entries, including ones recorded as absent —
    // that is the number of files the checkpoint governs, which is what the page
    // should report. Summing only the present ones would understate it.
    const totalBytes = manifest.files.reduce((sum, file) => sum + (file.present ? file.size ?? 0 : 0), 0)
    return {
      slotId: slot.slotId,
      status: 'available',
      // The manifest records the profile it was captured from; trust it over the
      // directory name so a renamed/moved profile still reports its true origin.
      profileName: manifest.profileName ?? profileName,
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
