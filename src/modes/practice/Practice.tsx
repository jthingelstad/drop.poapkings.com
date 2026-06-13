import { useEffect } from 'preact/hooks'
import type { CardsData } from '../../types'
import rawCards from '../../data/cards.json'
import { track } from '../../lib/analytics'
import PracticeLoop from './PracticeLoop'

const ALL_CARDS = (rawCards as CardsData).cards

export default function Practice() {
  useEffect(() => {
    track('mode.practice')
  }, [])

  return <PracticeLoop pool={ALL_CARDS} eyebrow="Practice round" />
}
