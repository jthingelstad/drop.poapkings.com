import type { ComponentChildren } from 'preact'

// One gate card for every gate in the app: profile required, ranked restricted,
// guest run, Ladder signed out, and the three clan-tag gates. Anatomy is fixed —
// a mark, the state in letter-spaced small caps, one sentence, exactly ONE gold
// primary action, and a secondary link only where a real second path exists.
// Replacing four ad-hoc card layouts with this is why the gates finally read as
// one family.

interface GateAction {
  label: string
  href?: string
  onAction?: () => void
  disabled?: boolean
}

export default function GateCard({
  mark,
  state,
  children,
  primary,
  secondary
}: {
  /** A seal, glyph, or empty-state art. Decorative. */
  mark?: ComponentChildren
  /** The state, e.g. "PROFILE REQUIRED" — rendered in small caps. */
  state: string
  /** The one sentence. */
  children: ComponentChildren
  primary: GateAction
  secondary?: GateAction
}) {
  return (
    <div class="ed-gate">
      {mark && (
        <div class="ed-gate__mark" aria-hidden="true">
          {mark}
        </div>
      )}
      <div class="ed-gate__state">{state}</div>
      <p class="ed-gate__line">{children}</p>
      {primary.href ? (
        <a class="ed-btn ed-btn--gold ed-btn--lg" href={primary.href}>
          {primary.label}
        </a>
      ) : (
        <button class="ed-btn ed-btn--gold ed-btn--lg" disabled={primary.disabled} onClick={primary.onAction}>
          {primary.label}
        </button>
      )}
      {secondary &&
        (secondary.href ? (
          <a class="ed-textlink ed-gate__secondary" href={secondary.href}>
            {secondary.label}
          </a>
        ) : (
          <button class="ed-textlink ed-gate__secondary" type="button" onClick={secondary.onAction}>
            {secondary.label}
          </button>
        ))}
    </div>
  )
}
