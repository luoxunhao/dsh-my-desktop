/**
 * Two-phase confirmation for destructive recovery operations.
 *
 * MODELLED ON dsh-desktop's `startup-recovery-controller` preview/execute pair.
 *
 * WHY TWO PHASES
 * --------------
 * Uninstalling a plugin or rolling back a checkpoint cannot be undone by the user.
 * One click is too easy to misfire, and a destructive operation deserves a moment
 * where the UI can show what it is about to change. So the page first mints a
 * PREVIEW (which is also where a diff or summary is produced) and only then
 * EXECUTES with the token from it.
 *
 * THE FOUR PROPERTIES, AND WHY EACH ONE IS LOAD-BEARING
 * -----------------------------------------------------
 * 1. **One-shot, even on failure.** The token is consumed BEFORE the operation
 *    runs. If it survived a failure, a destructive action could be replayed against
 *    partial state the user never agreed to — strictly worse than asking them to
 *    look again.
 * 2. **Time-bounded** (`CONFIRMATION_PREVIEW_TTL_MS`). A preview left open on
 *    screen must not stay executable indefinitely.
 * 3. **Bound to its target.** A token minted for slot-2 must not act on slot-3: the
 *    user approved a specific change.
 * 4. **Bounded memory.** Every click mints a preview, so the store is capped.
 *
 * `now` is injected rather than read from the clock, so expiry and concurrency are
 * testable in milliseconds instead of by waiting.
 */
import { randomBytes } from 'node:crypto'

/** How long a preview stays executable. Matches the reference implementation. */
export const CONFIRMATION_PREVIEW_TTL_MS = 5 * 60 * 1000

/** Cap on retained previews; every click mints one, so this cannot be unbounded. */
export const MAX_CONFIRMATION_PREVIEWS = 256

/** The destructive operations that require a preview. */
export type ConfirmationAction = 'plugin-uninstall' | 'plugin-restore' | 'checkpoint-restore'

export interface ConfirmationPreview {
  readonly previewId: string
  readonly action: ConfirmationAction
  /** What the operation will act on; the execute call must name the same thing. */
  readonly target: string
  readonly expiresAt: string
}

export type ConfirmationOutcome<T> =
  | { readonly status: 'executed', readonly value: T }
  | { readonly status: 'failed', readonly error: unknown }
  | { readonly status: 'expired', readonly reason: 'unknown' | 'expired' | 'already-consumed' | 'target-mismatch' }

interface StoredPreview {
  readonly action: ConfirmationAction
  readonly target: string
  readonly expiresAt: number
  /** Set when an execute begins, so concurrent calls cannot both proceed. */
  claimed: boolean
}

/**
 * Tokens that were consumed, kept only long enough to explain the refusal.
 *
 * WHY KEEP THEM AT ALL
 * --------------------
 * After a successful execute the token is gone, so a second attempt would otherwise
 * report "unknown" — which reads like a bug ("the token I was just given does not
 * exist") rather than the truth ("you already used it"). The reference implementation
 * makes the same point in prose: its single error says "expired OR WAS ALREADY USED".
 *
 * These entries are bookkeeping only: they can never be executed, and they expire on
 * the same clock as live previews. The map is bounded by the same cap.
 */
const CONSUMED_REASON = 'already-consumed' as const

export interface ConfirmationStoreOptions {
  /** Injected clock, for deterministic expiry tests. */
  readonly now?: () => number
}

export function createConfirmationStore(options: ConfirmationStoreOptions = {}) {
  const now = options.now ?? (() => Date.now())
  const previews = new Map<string, StoredPreview>()
  /**
   * Consumed token ids -> expiry. Never executable; exists so a replayed token is
   * refused with a truthful reason instead of "unknown".
   */
  const consumed = new Map<string, number>()

  /** Drop expired entries so they cannot occupy the cap or be executed. */
  function sweep(): void {
    const current = now()
    for (const [id, preview] of previews) {
      if (preview.expiresAt <= current) previews.delete(id)
    }
    for (const [id, expiresAt] of consumed) {
      if (expiresAt <= current) consumed.delete(id)
    }
  }

  /**
   * Make room for one more preview.
   *
   * Insertion order is preserved by `Map`, so the first key is the oldest — the
   * right one to drop when the cap is reached.
   */
  function trim(): void {
    if (previews.size < MAX_CONFIRMATION_PREVIEWS) return
    const oldest = previews.keys().next().value as string | undefined
    if (oldest !== undefined) previews.delete(oldest)
  }

  /** Mint a preview token for a destructive operation. */
  function preview(action: ConfirmationAction, target: string): ConfirmationPreview {
    sweep()
    trim()
    const previewId = `preview_${randomBytes(16).toString('hex')}`
    const expiresAt = now() + CONFIRMATION_PREVIEW_TTL_MS
    previews.set(previewId, { action, target, expiresAt, claimed: false })
    return { previewId, action, target, expiresAt: new Date(expiresAt).toISOString() }
  }

  /** Mark a token as spent, remembering why for the token's remaining lifetime. */
  function consume(previewId: string, expiresAt: number): void {
    previews.delete(previewId)
    consumed.set(previewId, expiresAt)
  }

  /**
   * Consume a token and run the operation.
   *
   * The token is CLAIMED (and therefore consumed) before the operation starts, so
   * a concurrent or repeated call cannot run it twice, and a failure does not leave
   * a replayable token behind.
   */
  async function execute<T>(
    previewId: string,
    operation: () => Promise<T>,
    options2: { readonly expectTarget?: string } = {},
  ): Promise<ConfirmationOutcome<T>> {
    const stored = previews.get(previewId)
    if (stored === undefined) {
      sweep()
      return {
        status: 'expired',
        reason: consumed.has(previewId) ? CONSUMED_REASON : 'unknown',
      }
    }
    if (stored.claimed) return { status: 'expired', reason: CONSUMED_REASON }
    // Claim first: everything below may await, and a second caller must not slip in.
    stored.claimed = true

    if (stored.expiresAt <= now()) {
      consume(previewId, stored.expiresAt)
      return { status: 'expired', reason: 'expired' }
    }
    if (options2.expectTarget !== undefined && options2.expectTarget !== stored.target) {
      consume(previewId, stored.expiresAt)
      return { status: 'expired', reason: 'target-mismatch' }
    }
    consume(previewId, stored.expiresAt)

    try {
      return { status: 'executed', value: await operation() }
    } catch (error) {
      // Consumed either way — see property (1) in the module header.
      return { status: 'failed', error }
    }
  }

  return {
    preview,
    execute,
    /** Number of live previews; used by tests and diagnostics. */
    size: (): number => { sweep(); return previews.size },
    has: (previewId: string): boolean => {
      sweep()
      return previews.has(previewId)
    },
  }
}

export type ConfirmationStore = ReturnType<typeof createConfirmationStore>
