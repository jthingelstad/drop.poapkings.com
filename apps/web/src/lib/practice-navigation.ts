import { layout } from './use-layout'

// Ledger is intentionally deactivated while its future is evaluated. Keep the
// implementation and practiceKind contract for stored history and rolling
// compatibility, but do not expose or route players into the drill.
export const PRACTICE_LEDGER_ENABLED = false

export function practiceLandingPath(): '/' | '/practice' {
  return layout.value === 'desktop' ? '/practice' : '/'
}

// A gate promising to open Practice should enter a drill immediately on mobile,
// where the standalone Practice hub folds into Home. Desktop still has the hub
// as a low-pressure training destination.
export function practiceEntryPath(): '/practice' | '/practice/costs' {
  return layout.value === 'desktop' ? '/practice' : '/practice/costs'
}
