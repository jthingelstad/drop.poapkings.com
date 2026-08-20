import { useEffect } from 'preact/hooks'
import { navigate, route } from '../../lib/router'
import { PRACTICE_LEDGER_ENABLED, practiceEntryPath, practiceLandingPath } from '../../lib/practice-navigation'
import Ledger from './Ledger'
import PracticeHub from './PracticeHub'
import PracticeLoop from './PracticeLoop'

function InactiveLedgerRedirect() {
  useEffect(() => navigate(practiceEntryPath()), [])
  return <PracticeHub />
}

export default function Practice() {
  if (route.value.startsWith('/practice/ledger')) {
    return PRACTICE_LEDGER_ENABLED ? <Ledger /> : <InactiveLedgerRedirect />
  }
  if (route.value.startsWith('/practice/costs')) {
    return <PracticeLoop eyebrow="Cost Recall session" onExit={() => navigate(practiceLandingPath())} />
  }
  return <PracticeHub />
}
