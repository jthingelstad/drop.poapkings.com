import { navigate, route } from '../../lib/router'
import Ledger from './Ledger'
import PracticeHub from './PracticeHub'
import PracticeLoop from './PracticeLoop'

export default function Practice() {
  if (route.value.startsWith('/practice/ledger')) return <Ledger />
  if (route.value.startsWith('/practice/costs')) {
    return <PracticeLoop eyebrow="Cost Recall session" onExit={() => navigate('/practice')} />
  }
  return <PracticeHub />
}
