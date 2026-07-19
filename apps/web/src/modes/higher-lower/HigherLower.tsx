import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card, ElixirMood } from '../../types'
import { getRecords, saveRecords } from '../../lib/storage'
import { pickLine } from '../../lib/elixir-lines'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import CardDisplay from '../../components/CardDisplay'
import ElixirHost from '../../components/ElixirHost'
import GameRunGate from '../../components/GameRunGate'
import RunScopeBadge from '../../components/RunScopeBadge'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'

// A correct read earns a quick beat; a miss keeps the longer one — that's the
// learning moment.
const ADVANCE_DELAY_CORRECT = 750
const ADVANCE_DELAY_WRONG = 1400
type Choice = 'higher' | 'equal' | 'lower'

function relation(left: Card, right: Card): Choice {
  if (right.elixir > left.elixir) return 'higher'
  if (right.elixir < left.elixir) return 'lower'
  return 'equal'
}

export default function HigherLower() {
  const gameRun = useGameSession('higher-lower', challengePreparers['higher-lower'])
  const advanceTimer = useRef<number | undefined>(undefined)
  const pairIndex = useSignal(0)
  const serverAnswers = useRef<Array<{ leftId: number; rightId: number; choice: Choice }>>([])
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
    const nextIndex = pairIndex.value + 1
    const nextPair = gameRun.content?.[nextIndex]
    if (!nextPair) {
      void gameRun.complete(
        { answers: serverAnswers.current },
        () => void restartAfterMiss(),
        () => void restartAfterMiss()
      )
      return
    }
    pairIndex.value = nextIndex
    picked.value = null
    revealed.value = false
    elixirLine.value = ''
    elixirMood.value = 'neutral'
  }

  async function restartAfterMiss() {
    pairIndex.value = 0
    serverAnswers.current = []
    await gameRun.prepare()
    picked.value = null
    revealed.value = false
    elixirLine.value = ''
    elixirMood.value = 'neutral'
  }

  function choose(choice: Choice) {
    const activePair = gameRun.content?.[pairIndex.value]
    if (revealed.value || !activePair) return
    const [left, right] = activePair
    const answer = relation(left, right)
    const correct = choice === answer
    serverAnswers.current.push({ leftId: left.id, rightId: right.id, choice })

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
      elixirMood.value = s >= 3 ? 'celebrate' : 'happy'
    } else {
      playWrong()
      streak.value = 0
      elixirLine.value = pickLine('hl_wrong')
      elixirMood.value = 'angry'
    }

    advanceTimer.current = window.setTimeout(
      () => {
        if (correct) {
          next()
        } else {
          // A permanently rejected or quarantined completion still deals the
          // next round — Higher/Lower has no summary screen to escape to.
          void gameRun.complete(
            { answers: serverAnswers.current },
            () => void restartAfterMiss(),
            () => void restartAfterMiss()
          )
        }
      },
      correct ? ADVANCE_DELAY_CORRECT : ADVANCE_DELAY_WRONG
    )
  }

  const pair = gameRun.content?.[pairIndex.value]
  if (!pair) {
    return (
      <GameRunGate preparing={gameRun.preparing.value} error={gameRun.error} onRetry={() => void gameRun.prepare()} />
    )
  }

  const [left, right] = pair
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
    <div class="main-content game-run hl" style={{ alignItems: 'center', gap: 22 }}>
      <RunScopeBadge ranked={gameRun.ranked.value} />
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
        {/* Pairs are chained: the left card is last round's right card, whose
            cost was already revealed — keep it visible so each round asks for
            exactly one new read. Round one stays fully hidden. */}
        <CardDisplay card={left} phase="playing" dropAnimKey={0} forceReveal={revealed.value || pairIndex.value > 0} />
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
            disabled={revealed.value || gameRun.preparing.value}
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
