import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { ElixirMood } from '../../types'
import { getRecords, saveRecords } from '../../lib/storage'
import { pickLine } from '../../lib/elixir-lines'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import CardDisplay from '../../components/CardDisplay'
import ElixirHost from '../../components/ElixirHost'
import FloatingCue from '../../components/FloatingCue'
import GameRunGate from '../../components/GameRunGate'
import GameMotion from '../../components/GameMotion'
import GameFxLayer, { preloadGameFx } from '../../components/GameFxLayer'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'
import { useGameRuntime } from '../../lib/use-game-runtime'

// A correct read earns a quick beat; a miss keeps the longer one — that's the
// learning moment.
const ADVANCE_DELAY_CORRECT = 750
const ADVANCE_DELAY_WRONG = 1400

export default function HigherLower() {
  const gameRun = useGameSession('higher-lower', challengePreparers['higher-lower'])
  const runtime = useGameRuntime({ initialStage: 'running', guardActiveRun: false, trackElapsed: false })
  const pairIndex = useSignal(0)
  const serverAnswers = useRef<Array<{ leftId: number; rightId: number; pickedId: number }>>([])
  // The card the player tapped as higher (for reveal highlighting).
  const picked = useSignal<number | null>(null)
  const revealed = useSignal(false)
  const streak = useSignal(0)
  const streakCue = useSignal(0)
  const best = useSignal(getRecords().longestStreak ?? 0)
  const elixirLine = useSignal(pickLine('idle'))
  const elixirMood = useSignal<ElixirMood>('neutral')

  useEffect(() => {
    track('mode.higherlower')
    preloadGameFx()
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
    runtime.emitCue('round-advance', { pairIndex: nextIndex })
  }

  async function restartAfterMiss() {
    runtime.reset('running')
    pairIndex.value = 0
    serverAnswers.current = []
    await gameRun.prepare()
    picked.value = null
    revealed.value = false
    elixirLine.value = ''
    elixirMood.value = 'neutral'
  }

  function choose(pickedId: number) {
    const activePair = gameRun.content?.[pairIndex.value]
    if (runtime.stage.value !== 'running' || revealed.value || !activePair) return
    const [left, right] = activePair
    // Pairs never tie, so exactly one card is the higher cost.
    const higherId = left.elixir > right.elixir ? left.id : right.id
    const correct = pickedId === higherId
    serverAnswers.current.push({ leftId: left.id, rightId: right.id, pickedId })

    picked.value = pickedId
    revealed.value = true

    if (correct) {
      playCorrect()
      const s = streak.value + 1
      streak.value = s
      if (s === 3 || (s > 3 && s % 5 === 0)) streakCue.value++
      if (s > best.value) {
        best.value = s
        saveRecords({ longestStreak: s })
      }
      elixirLine.value = s >= 3 ? pickLine('hl_streak', { n: s }) : pickLine('hl_right')
      elixirMood.value = s >= 3 ? 'celebrate' : 'happy'
      runtime.emitCue('answer-correct', { pairIndex: pairIndex.value })
    } else {
      playWrong()
      streak.value = 0
      elixirLine.value = pickLine('hl_wrong')
      elixirMood.value = 'angry'
      runtime.emitCue('answer-wrong', { pairIndex: pairIndex.value })
    }

    runtime.later(
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
  const higherId = left.elixir > right.elixir ? left.id : right.id

  function cardClass(cardId: number): string {
    if (!revealed.value) return 'hl__card'
    if (cardId === higherId) return 'hl__card hl__card--correct'
    if (cardId === picked.value) return 'hl__card hl__card--wrong'
    return 'hl__card hl__card--dim'
  }

  const disabled = revealed.value || gameRun.preparing.value

  return (
    <div class="main-content game-run hl" style={{ alignItems: 'center', gap: 22 }}>
      <GameFxLayer cue={runtime.cue.value} particleCount={6} />
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
        Tap the card that costs <strong>more</strong> elixir.
      </p>

      <GameMotion contentKey={pairIndex.value} cue={runtime.cue.value} preset="pair">
        <div class="hl__pair" role="group" aria-label="Tap the higher-cost card">
          <button type="button" class={cardClass(left.id)} onClick={() => choose(left.id)} disabled={disabled}>
            <CardDisplay card={left} phase="playing" dropAnimKey={0} forceReveal={revealed.value} />
          </button>
          <div class="hl__vs" aria-hidden="true">
            vs
          </div>
          <button type="button" class={cardClass(right.id)} onClick={() => choose(right.id)} disabled={disabled}>
            <CardDisplay card={right} phase="playing" dropAnimKey={0} forceReveal={revealed.value} />
          </button>
        </div>
      </GameMotion>

      <ElixirHost line={elixirLine.value} mood={elixirMood.value} />

      <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
        Home
      </button>

      {/* Shared floating streak cue — composited, never in layout flow. */}
      <div class="game-cues" aria-hidden="true">
        <div class="game-cues__slot game-cues__slot--top">
          <FloatingCue trigger={streakCue.value} className="floating-cue--streak">
            🔥 {streak.value} streak
          </FloatingCue>
        </div>
      </div>
    </div>
  )
}
