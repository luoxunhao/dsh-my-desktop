/**
 * A single-select dropdown with full keyboard support.
 *
 * Ported from the `createListbox` factory in `assets/settings.html`, which built
 * the same control twice with imperative DOM. Expressing it as a component means
 * the keyboard model is written once and both selects inherit it.
 *
 * WHY THIS IS NOT A `<select>`
 * ----------------------------
 * A native `<select>` cannot be styled to match the settings page, and its popup
 * is drawn by the OS. The original therefore hand-rolled an ARIA listbox, and
 * this preserves that contract exactly — including the parts that are easy to
 * lose in a rewrite:
 *
 * - Opening (click, ArrowDown, ArrowUp) moves focus to the SELECTED option, not
 *   the first one.
 * - Arrow keys wrap around both ends.
 * - Home / End jump to the ends.
 * - Escape closes AND returns focus to the trigger.
 * - Tab closes without stealing focus, letting the browser move on naturally.
 * - A pointerdown anywhere outside the trigger's wrapper closes it. The check is
 *   on `wrapper.contains`, not on the trigger, because clicks INSIDE the popup
 *   must not close it before the option's own click handler runs.
 *
 * `role="listbox"` + `role="option"` + `aria-selected` + `aria-expanded` are the
 * attributes the original exposed, and they are what makes this announce
 * correctly, so they are preserved rather than replaced with buttons.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'

export interface SelectOption<T extends string> {
  readonly value: T
  readonly label: string
}

export interface ListboxProps<T extends string> {
  /** Localized, human-readable name for the control (used by `aria-labelledby`). */
  readonly labelId: string
  readonly options: readonly SelectOption<T>[]
  readonly value: T
  /** Called only on an actual user selection, never on the initial render. */
  readonly onChange: (value: T) => void
  /** Chevron glyph source, so each window can point at its own asset path. */
  readonly chevronSrc: string
}

export function Listbox<T extends string>({ labelId, options, value, onChange, chevronSrc }: ListboxProps<T>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listId = useId()

  const selected = options.find(option => option.value === value) ?? options[0]

  const close = useCallback((restoreFocus: boolean): void => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  /** Move focus to the option matching `value`, or the first one as a fallback. */
  const focusSelected = useCallback((): void => {
    const index = options.findIndex(option => option.value === value)
    optionRefs.current[index < 0 ? 0 : index]?.focus()
  }, [options, value])

  useEffect(() => {
    if (!open) return
    focusSelected()
  }, [open, focusSelected])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const wrapper = wrapperRef.current
      if (wrapper !== null && !wrapper.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const move = useCallback((delta: number): void => {
    const active = optionRefs.current.findIndex(node => node === document.activeElement)
    const start = active < 0 ? 0 : active
    const next = (start + delta + options.length) % options.length
    optionRefs.current[next]?.focus()
  }, [options.length])

  const commit = useCallback((next: T): void => {
    onChange(next)
    close(true)
  }, [close, onChange])

  return (
    <div className="select-wrap" ref={wrapperRef}>
      <button
        type="button"
        className="select-trigger"
        ref={triggerRef}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(current => !current)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span>{selected?.label ?? ''}</span>
        <img src={chevronSrc} alt="" />
      </button>
      <div
        className="select-menu"
        id={listId}
        role="listbox"
        aria-labelledby={labelId}
        hidden={!open}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close(true)
          } else if (event.key === 'Tab') {
            // Close but do NOT restore focus: Tab must be allowed to move on.
            close(false)
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            move(1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            move(-1)
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault()
            optionRefs.current[event.key === 'Home' ? 0 : options.length - 1]?.focus()
          }
        }}
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="option"
            className="select-option"
            aria-selected={option.value === value}
            ref={node => { optionRefs.current[index] = node }}
            onClick={() => commit(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
