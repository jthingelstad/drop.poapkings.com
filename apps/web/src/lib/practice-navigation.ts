import { layout } from './use-layout'

export function practiceLandingPath(): '/' | '/practice' {
  return layout.value === 'desktop' ? '/practice' : '/'
}

// A gate promising to open Practice should enter a drill immediately on mobile,
// where the standalone Practice hub folds into Home. Desktop still has the hub
// and should preserve the choice between Cost Recall and Ledger.
export function practiceEntryPath(): '/practice' | '/practice/costs' {
  return layout.value === 'desktop' ? '/practice' : '/practice/costs'
}
