/**
 * A labelled toggle row with a checkbox input behind it.
 *
 * The visual switch is two spans and CSS; the actual control is a real
 * `<input type="checkbox">` kept in the DOM (not replaced by a styled div) so
 * that focus, keyboard toggling, form semantics and screen-reader
 * announcements all come from the platform. The original did this too, and it is
 * the reason the switch stays accessible while looking custom.
 *
 * The whole row is a `<label>`, so clicking anywhere on the text toggles the
 * control without any JavaScript.
 */

export interface SwitchRowProps {
  readonly id: string
  /** Element id of the visible label, referenced by the input's `aria-labelledby`. */
  readonly labelId: string
  readonly title: string
  readonly description: string
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onChange: (checked: boolean) => void
}

export function SwitchRow({ id, labelId, title, description, checked, disabled, onChange }: SwitchRowProps): React.JSX.Element {
  return (
    <label className="row" htmlFor={id}>
      <span>
        <span className="label" id={labelId}>{title}</span>
        <span className="description">{description}</span>
      </span>
      <span className="switch">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={event => onChange(event.currentTarget.checked)}
        />
        <span className="track" aria-hidden="true" />
      </span>
    </label>
  )
}
