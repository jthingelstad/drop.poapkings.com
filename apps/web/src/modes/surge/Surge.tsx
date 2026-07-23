import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Answer, Insights } from '../../lib/insights'
import { pointerVerb } from '../../lib/use-layout'
import { saveResult, getRecords, saveRecords } from '../../lib/storage'
import { computeInsights } from '../../lib/insights'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { formatSeconds } from '../../lib/format'
import { useGameRuntime } from '../../lib/use-game-runtime'
import CardDisplay from '../../components/CardDisplay'
import GameMotion from '../../components/GameMotion'
import { preloadGameFx } from '../../components/GameFxLayer'
import Icon from '../../components/Icon'
import FloatingCue from '../../components/FloatingCue'
import PipKeypad from '../../components/PipKeypad'
import Summary from '../../components/Summary'
import ShareLine from '../../components/ShareLine'
import GameRunGate from '../../components/GameRunGate'
import GameFrame from '../../components/game/GameFrame'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'

// Surge tunables — one config object (SPEC §9).
const SURGE = {
  SPRINT_LEN: 15,
  PENALTY_MS: 2000,
  MODE: 'sprint' as 'sprint' | 'blitz',
  BLITZ_MS: 60000
}

const CORRECT_BEAT_MS = 280
const WRONG_BEAT_MS = 430
const COUNTDOWN_STEP_MS = 650

export default function Surge() {
  const gameRun = useGameSession('surge', challengePreparers.surge)
  const answers = useRef<Answer[]>([])
  const cardStart = useRef(0)
  const firstGuess = useRef(0)
  const firstCorrect = useRef(false)
  const recorded = useRef(false)
  const started = useRef(false)
  const runStartedAt = useRef(0)
  const currentGuesses = useRef<number[]>([])
  const serverAnswers = useRef<Array<{ cardId: number; guesses: number[]; atMs: number }>>([])

  const runtime = useGameRuntime({ countdownStepMs: COUNTDOWN_STEP_MS })
  const { stage, count, elapsedMs, later } = runtime
  const index = useSignal(0)
  const cardPhase = useSignal<'playing' | 'correct' | 'wrong'>('playing')
  // After a wrong tap, point at the answer relative to the latest guess.
  const hint = useSignal<'higher' | 'lower' | null>(null)

  const insights = useSignal<Insights | null>(null)
  const paceDelta = useSignal<{ aheadMs: number } | null>(null)
  const pacePulse = useSignal(0)
  const paceTimer = useRef<number | undefined>(undefined)
  const totalMs = useSignal(0)
  const isPB = useSignal(false)
  const prevBest = useSignal<number | undefined>(undefined)

  useEffect(() => {
    preloadGameFx()
  }, [])

  // No manual "ready" screen in the redesign: Play → countdown. Auto-start once
  // the signed challenge + card art are loaded. `started` re-arms on replay.
  // start() is reached via a ref so this effect only re-fires on load state.
  const startRef = useRef<() => void>(() => {})
  startRef.current = start
  useEffect(() => {
    if (gameRun.content && gameRun.assetsReady && !started.current && stage.peek() === 'ready') {
      started.current = true
      startRef.current()
    }
  }, [gameRun.content, gameRun.assetsReady, stage])

  async function start() {
    if (!(await gameRun.ensureFreshRun())) return
    runtime.start((startedAt) => {
      cardStart.current = startedAt
      runStartedAt.current = startedAt
      recorded.current = false
      currentGuesses.current = []
      serverAnswers.current = []
      index.value = 0
      cardPhase.value = 'playing'
      hint.value = null
    })
  }

  function showNext() {
    const nextIdx = index.value + 1
    if (nextIdx >= SURGE.SPRINT_LEN) {
      finish()
      return
    }
    index.value = nextIdx
    cardStart.current = performance.now()
    recorded.current = false
    currentGuesses.current = []
    cardPhase.value = 'playing'
    hint.value = null
    runtime.emitCue('round-advance', { cardId: gameRun.content?.[nextIdx]?.id })
  }

  function finish(finalScore?: number) {
    const total = finalScore ?? runtime.currentElapsed()
    const ins = computeInsights(answers.current)
    const best = getRecords().surgeBest
    const pb = best === undefined || total < best

    totalMs.value = total
    elapsedMs.value = total
    insights.value = ins
    prevBest.value = best
    isPB.value = pb

    // Penalty-adjusted elapsed at each card, for next run's ghost pacing. The
    // all-time best (surgeBest) is now persisted centrally only when the server
    // accepts the run; this pace snapshot rides along on that same acceptance.
    const bestPace = serverAnswers.current.map((answer, index) => {
      const misses = serverAnswers.current.slice(0, index + 1).reduce((sum, entry) => sum + entry.guesses.length - 1, 0)
      return Math.round(answer.atMs) + misses * SURGE.PENALTY_MS
    })
    runtime.finish()
    void gameRun.complete({ answers: serverAnswers.current }, () => {
      if (pb) saveRecords({ surgeBestPace: bestPace })
    })
  }

  function answer(picked: number) {
    if (stage.value !== 'running' || cardPhase.value !== 'playing') return
    const card = gameRun.content?.[index.value]
    if (!card) return
    const correct = picked === card.elixir
    // Mirror the server's transcript cap: wrong taps beyond it still penalize
    // locally but are no longer recorded, so a mashing beginner cannot push
    // the transcript past what the server accepts.
    if (correct || currentGuesses.current.length < 59) currentGuesses.current.push(picked)

    if (!recorded.current) {
      recorded.current = true
      firstGuess.current = picked
      firstCorrect.current = correct
    }

    if (correct) {
      playCorrect()
      const ms = performance.now() - cardStart.current
      const atMs = performance.now() - runStartedAt.current
      answers.current.push({ card, guess: firstGuess.current, correct: firstCorrect.current, ms })
      serverAnswers.current.push({ cardId: card.id, guesses: [...currentGuesses.current], atMs })
      saveResult(card.id, firstCorrect.current, ms)
      // Ghost pacing: at the checkpoints, show the delta against the PB run.
      const solved = serverAnswers.current.length
      const pace = getRecords().surgeBestPace
      if ((solved === 5 || solved === 10) && pace?.[solved - 1] !== undefined) {
        const missesSoFar = serverAnswers.current.reduce((sum, answer) => sum + answer.guesses.length - 1, 0)
        paceDelta.value = { aheadMs: pace[solved - 1]! - (atMs + missesSoFar * SURGE.PENALTY_MS) }
        pacePulse.value += 1
        window.clearTimeout(paceTimer.current)
        paceTimer.current = window.setTimeout(() => (paceDelta.value = null), 2000)
      }
      cardPhase.value = 'correct'
      hint.value = null
      runtime.emitCue('answer-correct', { cardId: card.id })
      if (index.value + 1 >= SURGE.SPRINT_LEN) {
        const misses = serverAnswers.current.reduce((sum, answer) => sum + answer.guesses.length - 1, 0)
        later(() => finish(Math.round(atMs) + misses * SURGE.PENALTY_MS), CORRECT_BEAT_MS)
      } else {
        later(showNext, CORRECT_BEAT_MS)
      }
    } else {
      playWrong()
      runtime.addPenalty(SURGE.PENALTY_MS)
      hint.value = picked < card.elixir ? 'higher' : 'lower'
      cardPhase.value = 'wrong'
      runtime.emitCue('answer-wrong', { cardId: card.id })
      later(() => (cardPhase.value = 'playing'), WRONG_BEAT_MS)
    }
  }

  function replay() {
    track('game.replayed', 'surge')
    runtime.reset('ready')
    answers.current = []
    serverAnswers.current = []
    currentGuesses.current = []
    recorded.current = false
    started.current = false
    insights.value = null
    cardPhase.value = 'playing'
    hint.value = null
    index.value = 0
    void gameRun.prepare()
  }

  if (!gameRun.content) {
    return (
      <GameRunGate preparing={gameRun.preparing.value} error={gameRun.error} onRetry={() => void gameRun.prepare()} />
    )
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  if (stage.value === 'summary' && insights.value) {
    const ins = insights.value
    const pbCallout = isPB.value
      ? prevBest.value !== undefined
        ? `New best! −${formatSeconds(prevBest.value - totalMs.value)}s`
        : 'First Surge logged'
      : prevBest.value !== undefined
        ? `Best: ${formatSeconds(prevBest.value)}s`
        : undefined

    return (
      <div class="ed-gamewrap">
        <Summary
          eyebrow="Surge complete"
          headline={`${formatSeconds(totalMs.value)}s`}
          pbCallout={pbCallout}
          insights={ins}
          moments={[
            { label: 'Cards', value: String(SURGE.SPRINT_LEN) },
            { label: 'Avg / card', value: `${formatSeconds(totalMs.value / SURGE.SPRINT_LEN)}s`, tone: 'gold' },
            { label: 'Accuracy', value: `${ins.accuracyPct}%`, tone: 'green' }
          ]}
          shareAction={<ShareLine mode="surge" score={`${formatSeconds(totalMs.value)}s`} />}
          onReplay={replay}
          replayLabel="Play again"
          onHome={() => navigate('/')}
        />
      </div>
    )
  }

  // ── Loading (pre-countdown) ───────────────────────────────────────────────
  if (stage.value === 'ready') {
    return (
      <div class="ed-gamewrap ed-gameloading" aria-live="polite">
        <span class="ed-drop-shape ed-gameloading__drop" aria-hidden="true" />
        <span>Loading cards…</span>
      </div>
    )
  }

  // ── Countdown + Running ──────────────────────────────────────────────────
  const counting = stage.value === 'countdown'
  const card = gameRun.content[index.value]!
  const pace = paceDelta.value
  const paceAhead = (pace?.aheadMs ?? 0) >= 0
  return (
    <GameFrame
      modeName="Surge"
      counting={counting}
      count={count.value}
      onQuit={() => navigate('/')}
      cue={runtime.cue.value}
      fxParticles={16}
      progressText={`Card ${Math.min(index.value + 1, SURGE.SPRINT_LEN)} / ${SURGE.SPRINT_LEN}`}
      metric={{ value: `${formatSeconds(elapsedMs.value)}s`, label: 'time' }}
      progressPct={(index.value / SURGE.SPRINT_LEN) * 100}
    >
      <div class="ed-kstage">
        <div class="ed-kstage__card">
          <GameMotion contentKey={card.id} cue={runtime.cue.value}>
            <CardDisplay card={card} phase={cardPhase.value} revealCost={false} />
          </GameMotion>
        </div>
        <div class="ed-kstage__hint">{pointerVerb()} the elixir cost</div>
        <PipKeypad onPick={answer} disabled={cardPhase.value !== 'playing'} />

        {/* Transient feedback, composited over the game — never in layout flow. */}
        <div class="game-cues" aria-hidden="true">
          <div class="game-cues__slot game-cues__slot--top">
            <FloatingCue trigger={runtime.penaltyPulse.value} className="floating-cue--penalty">
              <Icon name="timer" /> +2s
            </FloatingCue>
            <FloatingCue
              trigger={pacePulse.value}
              className={`floating-cue--pace ${paceAhead ? 'is-ahead' : 'is-behind'}`}
            >
              <Icon name={paceAhead ? 'arrow-up' : 'arrow-down'} />
              {(Math.abs(pace?.aheadMs ?? 0) / 1000).toFixed(1)}s {paceAhead ? 'ahead' : 'behind'}
            </FloatingCue>
          </div>
          <div class="game-cues__slot game-cues__slot--bottom">
            <FloatingCue trigger={runtime.penaltyPulse.value} className="floating-cue--hint" testId="surge-hint">
              {hint.value === 'higher' && (
                <>
                  <Icon name="arrow-up" /> Higher
                </>
              )}
              {hint.value === 'lower' && (
                <>
                  <Icon name="arrow-down" /> Lower
                </>
              )}
            </FloatingCue>
          </div>
        </div>
        <span class="sr-only" aria-live="assertive">
          {cardPhase.value === 'wrong' && hint.value ? (hint.value === 'higher' ? 'Higher' : 'Lower') : ''}
        </span>
      </div>
    </GameFrame>
  )
}
