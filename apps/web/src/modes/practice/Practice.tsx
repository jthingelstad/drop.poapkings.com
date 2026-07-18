import { useEffect } from 'preact/hooks'
import { track } from '../../lib/analytics'
import PracticeLoop from './PracticeLoop'

export default function Practice() {
  useEffect(() => {
    track('mode.practice')
  }, [])

  return <PracticeLoop eyebrow="Practice round" />
}
