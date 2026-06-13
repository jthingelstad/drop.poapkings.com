import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card, CardsData, ElixirMood } from '../../types'
import rawCards from '../../data/cards.json'
import { sampleUnseenCard } from '../../lib/sampling'
import { getRecords, saveRecords } from '../../lib/storage'
import { pickLine } from '../../lib/elixir-lines'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import CardDisplay from '../../components/CardDisplay'
import ElixirHost from '../../components/ElixirHost'

const cardsData = rawCards as CardsData
const ALL_CARDS = cardsData.cards

const ADVANCE_DELAY = 1400
type Choice = 'higher' | 'equal' | 'lower'

function rememberRecent(recent: number[], id: number) {
  recent.push(id)
  if (recent.length > 6) recent.shift()
}

function pickPair(seen: Set<number>, recent: number[]): [Card, Card] {
  const left = sampleUnseenCard(ALL_CARDS, seen, recent)
  rememberRecent(recent, left.id)
  const right = sampleUnseenCard(ALL_CARDS, seen, recent, [left.id])
  rememberRecent(recent, right.id)
  return [left, right]
}

function relation(left: Card, right: Card): Choice {
  if (right.elixir > left.elixir) return 'higher'
  if (right.elixir < left.elixir) return 'lower'
  return 'equal'
}

export default function HigherLower() {
  const advanceTimer = useRef<number | undefined>(undefined)
  const seen = useRef<Set<number>>(new Set())
  const recent = useRef<number[]>([])
  const initialPair = useRef<[Card, Card] | null>(null)
  if (!initialPair.current) initialPair.current = pickPair(seen.current, recent.current)

  const pair = useSignal<[Card, Card]>(initialPair.current!)
  const picked = useSignal<Choice | null>(null)
  const revealed = useSignal(false)
  const streak = useSignal(0)
  const best = useSignal(getRecords().longestStreak ?? 0)
  const elixirLine = useSignal(pickLine('idle'))
  const elixirMood = useSignal<ElixirMood>('neutral')

  useEffect(() => {
    track('mode.higherlower')
    return () => clearTimeout(advanceTimer.current)
  }, [])

  function next() {
    pair.value = pickPair(seen.current, recent.current)
    picked.value = null
    revealed.value = false
    elixirLine.value = ''
    elixirMood.value = 'neutral'
  }

  function choose(choice: Choice) {
    if (revealed.value) return
    const [left, right] = pair.value
    const answer = relation(left, right)
    const correct = choice === answer

    picked.value = choice
    revealed.value = true

    if (correct) {
      playCorrect()
      const s = streak.value + 1
      streak.value = s
      if (s > best.value) {
        best.value = s
        saveRecords({ longestStreak: s })
      }
      elixirLine.value = s >= 3 ? pickLine('hl_streak', { n: s }) : pickLine('hl_right')
      elixirMood.value = 'hype'
    } else {
      playWrong()
      streak.value = 0
      elixirLine.value = pickLine('hl_wrong')
      elixirMood.value = 'unimpressed'
    }

    advanceTimer.current = window.setTimeout(next, ADVANCE_DELAY)
  }

  const [left, right] = pair.value
  const answer = relation(left, right)
  const controls: { choice: Choice; label: string }[] = [
    { choice: 'higher', label: 'Higher' },
    { choice: 'equal', label: 'Equal' },
    { choice: 'lower', label: 'Lower' }
  ]

  function controlClass(choice: Choice): string {
    if (!revealed.value) return 'hl-control'
    const classes = ['hl-control']
    if (choice === answer) classes.push('hl-control--correct')
    else if (choice === picked.value) classes.push('hl-control--wrong')
    else classes.push('hl-control--dim')
    return classes.join(' ')
  }

  return (
    <div class="main-content hl" style={{ alignItems: 'center', gap: 22 }}>
      <div class="session-bar">
        <div class="session-bar__stat">
          <span class="session-bar__val">{streak.value}</span>
          <span>streak</span>
        </div>
        <div class="session-bar__stat">
          <span class="session-bar__val">{best.value}</span>
          <span>best</span>
        </div>
      </div>

      <p class="lede hl__prompt">
        Is the <strong>right</strong> card higher, lower, or equal?
      </p>

      <div class="hl__pair">
        <CardDisplay card={left} phase="playing" dropAnimKey={0} forceReveal={revealed.value} />
        <div class="hl__vs" aria-hidden="true">
          vs
        </div>
        <CardDisplay card={right} phase="playing" dropAnimKey={0} forceReveal={revealed.value} />
      </div>

      <div class="hl-controls" role="group" aria-label="Higher, equal, or lower">
        {controls.map((c) => (
          <button
            key={c.choice}
            class={controlClass(c.choice)}
            onClick={() => choose(c.choice)}
            disabled={revealed.value}
          >
            {c.label}
          </button>
        ))}
      </div>

      <ElixirHost line={elixirLine.value} mood={elixirMood.value} />

      <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
        Home
      </button>
    </div>
  )
}
