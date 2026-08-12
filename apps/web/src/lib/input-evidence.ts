export type RunInputKind = 'pointer' | 'keyboard' | 'keyboard-or-assistive'

export interface InputObservation {
  inputAt: number
  inputKind: RunInputKind
  trusted: boolean
}

export interface RunInputEvidence {
  round: number
  value: number
  enabledAtMs: number
  inputAtMs: number
  inputKind: RunInputKind
  trusted: boolean
}

// Capture only the coarse facts needed to interpret competitive timing. Drop
// deliberately does not retain coordinates, pressure, pointer identity, or key
// codes. A zero-detail native click may come from a keyboard or an assistive
// technology, and the browser does not expose a reliable way to separate them.
export function observeInput(event: Event): InputObservation {
  const inputKind: RunInputKind =
    event instanceof KeyboardEvent
      ? 'keyboard'
      : event.type.startsWith('pointer') || (event instanceof MouseEvent && event.detail > 0)
        ? 'pointer'
        : 'keyboard-or-assistive'
  return { inputAt: performance.now(), inputKind, trusted: event.isTrusted }
}

export function runInputEvidence(
  observation: InputObservation,
  runStartedAt: number,
  enabledAt: number,
  round: number,
  value: number
): RunInputEvidence {
  return {
    round,
    value,
    enabledAtMs: Math.max(0, Math.round(enabledAt - runStartedAt)),
    inputAtMs: Math.max(0, Math.round(observation.inputAt - runStartedAt)),
    inputKind: observation.inputKind,
    trusted: observation.trusted
  }
}
