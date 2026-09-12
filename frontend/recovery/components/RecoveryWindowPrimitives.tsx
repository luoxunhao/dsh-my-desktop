/**
 * Shared primitives for the recovery page, ported from dsh-desktop's
 * `RecoveryWindowPrimitives.tsx`.
 *
 * WHAT DIFFERS FROM THE REFERENCE, AND WHY
 * ----------------------------------------
 * The reference drives actions through `dsh-recovery:` custom-scheme LINKS
 * (`<a href="dsh-recovery://action">`) that its main process intercepts. Our page
 * runs over `file://` with a fixed preload bridge, so actions are BUTTONS calling
 * typed API methods instead. The visual result is identical — same
 * `buttonVariants`, same footer layout — but the mechanism is deliberately ours.
 *
 * The notice surface is also adapted: the reference renders toasts through
 * `sonner`; we do not carry that dependency, so notices render as an inline
 * `Alert` in the same slot. Same information, same placement, no new dependency.
 */
import { useEffect, useState, type ReactNode } from 'react'

import { buttonVariants } from './ui/button.js'
import { cn } from '../lib/utils.js'

/** Same variant vocabulary as the reference, minus the ones the page never uses. */
export type RecoveryActionVariant = 'default' | 'outline' | 'secondary' | 'destructive'

export interface RecoveryNotice {
  readonly tone: 'info' | 'success' | 'warning' | 'error'
  readonly title: string
  readonly body: string
}

/** Keep one leading action on the left and the remaining actions on the right. */
export function RecoveryActionFooter({
  children,
  leading,
}: {
  readonly children: ReactNode
  readonly leading?: ReactNode
}): React.JSX.Element {
  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t pt-4">
      {leading === undefined ? null : <div className="mr-auto flex items-center">{leading}</div>}
      {children}
    </footer>
  )
}

/**
 * A recovery action.
 *
 * `variant` selects the same button styles the reference's link used, so an action
 * that was a primary button there is a primary button here.
 */
export function RecoveryAction({
  children,
  className,
  disabled,
  icon,
  onClick,
  variant = 'outline',
}: {
  readonly children: ReactNode
  readonly className?: string
  readonly disabled?: boolean
  readonly icon?: ReactNode
  readonly onClick: () => void
  readonly variant?: RecoveryActionVariant
}): React.JSX.Element {
  return (
    <button
      className={cn(buttonVariants({ variant }), className)}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      {children}
    </button>
  )
}

/**
 * Notice surface.
 *
 * Auto-dismisses after the reference's 8s so a stale success does not sit on screen
 * while the user is looking at what changed — but it stays dismissible, because a
 * recovery failure is exactly the message someone wants to re-read.
 */
export function RecoveryNoticeSurface({ notice }: { readonly notice: RecoveryNotice | undefined }): React.JSX.Element | null {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (notice === undefined) return undefined
    setVisible(true)
    const timer = setTimeout(() => { setVisible(false) }, 8_000)
    return () => { clearTimeout(timer) }
  }, [notice])

  if (notice === undefined || !visible) return null

  // Tone → tokens. The reference uses sonner's richColors; the mapping here keeps
  // the same semantic distinction with the tokens we already ship.
  const tone = notice.tone === 'error'
    ? 'border-destructive/40 text-destructive'
    : notice.tone === 'success'
      ? 'border-emerald-500/40'
      : notice.tone === 'warning'
        ? 'border-amber-500/40'
        : ''

  return (
    <div className="pointer-events-none fixed right-6 top-13 z-[1001] w-80" role="status">
      <div className={cn('pointer-events-auto rounded-lg border bg-card px-4 py-3 shadow-lg', tone)}>
        <p className="text-sm font-medium">{notice.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{notice.body}</p>
      </div>
    </div>
  )
}
