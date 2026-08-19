import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { LedgerAnswer, LedgerStage } from '@elixir-drop/contracts'
import FloatingCue from '../../components/FloatingCue'
import GameRunGate from '../../components/GameRunGate'
import Summary from '../../components/Summary'
import DrillPanel from '../../components/summary/DrillPanel'
import { ledgerSignature } from '../../lib/signatures'
import {
  balanceWinner,
  EXCHANGE_PROMPT,
  ExchangeBoard,
  ExchangePad,
  exchangeSolvedLine,
  type LaneCard
} from '../../components/game/ExchangeBoard'
import GameFrame from '../../components/game/GameFrame'
import GameStartScreen from '../../components/game/GameStart'
import { preloadGameFx } from '../../components/GameFxLayer'
import { challengePreparers } from '../../lib/game-challenge-content'
import { computeInsights } from '../../lib/insights'
import {
  dealLedgerSequence,
  formatLedgerBalance,
  isFluentCard,
  LEDGER_ANSWERS,
  ledgerStage,
  type LedgerSequence
} from '../../lib/ledger'
import { navigate } from '../../lib/router'
import { practiceLandingPath } from '../../lib/practice-navigation'
import { playCorrect, playWrong } from '../../lib/sound'
import { getCardStats, getLedgerStats, recordSession, saveLedgerResult } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { useGameKeys } from '../../lib/use-game-keys'
import { useGameRuntime } from '../../lib/use-game-runtime'
import { useGameSession } from '../../lib/use-game-session'
import { preloadImages } from '../../lib/preload'

const PLAY_BEAT_MS = 720
const FEEDBACK_HOLD_MS = 1_250
const MAX_RESPONSE_MS = 60_000

type Phase = 'dealing' | 'answering' | 'correct' | 'wrong'

function stageLabel(stage: LedgerStage): string {
  if (stage === 'guided') return 'Guided'
  if (stage === 'faded') return 'Faded'
  return 'Tracked'
}

function runningBalance(sequence: LedgerSequence, count: number): number {
  return sequence.plays
    .slice(0, count)
    .reduce((sum, play) => sum + (play.side === 'red' ? play.card.elixir : -play.card.elixir), 0)
}

export default function Ledger() {
  const gameRun = useGameSession('practice', challengePreparers.practice, { practiceKind: 'ledger' })
  const runtime = useGameRuntime({ initialStage: 'running', guardActiveRun: false, trackElapsed: false })
  const deck = gameRun.content
  const serverAnswers = useRef<LedgerAnswer[]>([])
  // Per-answer sequence length + correctness, kept alongside the server transcript
  // (which carries neither) so the summary can draw accuracy by sequence length.
  const gradedAnswers = useRef<{ length: number; correct: boolean }[]>([])
  const generation = useRef(0)
  const previousIds = useRef<Set<number>>(new Set())
  const promptStartedAt = useRef(0)
  const promptPausedAt = useRef<number | null>(null)
  const promptPausedMs = useRef(0)

  const sequence = useSignal<LedgerSequence | null>(null)
  const revealed = useSignal(0)
  const phase = useSignal<Phase>('dealing')
  const picked = useSignal<number | null>(null)
  const assistance = useSignal(false)
  const checks = useSignal(0)
  const correct = useSignal(0)
  const assistedChecks = useSignal(0)
  const lastStats = useSignal(getLedgerStats())
  const feedbackPulse = useSignal(0)

  useEffect(() => {
    preloadGameFx()
  }, [])

  // A Ledger sequence is the prompt: letting its beats run in a background tab
  // makes the player return to an answer they never saw. Freeze an active read,
  // replay an interrupted sequence from the top, and exclude hidden time from
  // the response sample exactly as Cost Recall does.
  useEffect(() => {
    const onVisibilityChange = () => {
      const currentPhase = phase.peek()
      if (document.visibilityState === 'hidden') {
        if (currentPhase === 'answering' && promptPausedAt.current === null) {
          promptPausedAt.current = performance.now()
        } else if (currentPhase !== 'answering') {
          generation.current += 1
          runtime.clearScheduled()
        }
        return
      }

      if (currentPhase === 'answering') {
        if (promptPausedAt.current !== null) {
          promptPausedMs.current += performance.now() - promptPausedAt.current
          promptPausedAt.current = null
        }
        return
      }

      if (currentPhase === 'dealing') {
        const active = sequence.peek()
        if (active) beginSequence(active)
        return
      }

      dealNext()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-only listener reads current refs and signals

  useEffect(() => {
    if (!deck || !gameRun.assetsReady || sequence.peek()) return
    dealNext()
  }, [deck, gameRun.assetsReady]) // eslint-disable-line react-hooks/exhaustive-deps -- readiness owns the first deal

  function revealPlay(activeGeneration: number, count: number): void {
    if (activeGeneration !== generation.current) return
    const active = sequence.peek()
    if (!active) return
    revealed.value = count
    if (count >= active.plays.length) {
      runtime.later(() => {
        if (activeGeneration !== generation.current) return
        phase.value = 'answering'
        promptStartedAt.current = performance.now()
        promptPausedAt.current = null
        promptPausedMs.current = 0
      }, PLAY_BEAT_MS)
      return
    }
    runtime.later(() => revealPlay(activeGeneration, count + 1), PLAY_BEAT_MS)
  }

  function beginSequence(next: LedgerSequence): void {
    runtime.clearScheduled()
    const activeGeneration = ++generation.current
    sequence.value = next
    revealed.value = 0
    phase.value = 'dealing'
    picked.value = null
    assistance.value = false
    promptPausedAt.current = null
    promptPausedMs.current = 0
    preloadImages(
      next.plays.map((play) => play.card),
      () => {
        if (document.visibilityState !== 'hidden') revealPlay(activeGeneration, 1)
      }
    )
  }

  function dealNext(): void {
    if (!deck?.length) return
    const next = dealLedgerSequence(deck, getLedgerStats(), previousIds.current)
    previousIds.current = new Set(next.plays.map((play) => play.card.id))
    beginSequence(next)
  }

  function responseMs(): number {
    const pausedNow = promptPausedAt.current === null ? 0 : performance.now() - promptPausedAt.current
    return Math.round(
      Math.max(
        0,
        Math.min(MAX_RESPONSE_MS, performance.now() - promptStartedAt.current - promptPausedMs.current - pausedNow)
      )
    )
  }

  function guess(value: number): void {
    const active = sequence.peek()
    if (!active || phase.peek() !== 'answering') return
    picked.value = value
    const isCorrect = value === active.balance
    if (isCorrect) {
      playCorrect()
      correct.value += 1
      phase.value = 'correct'
    } else {
      playWrong()
      phase.value = 'wrong'
    }
    checks.value += 1
    if (assistance.peek()) assistedChecks.value += 1
    const answer: LedgerAnswer = {
      plays: active.plays.map(({ side, cardId }) => ({ side, cardId })),
      guess: value,
      responseMs: responseMs(),
      assisted: assistance.peek(),
      stage: active.stage
    }
    serverAnswers.current.push(answer)
    gradedAnswers.current.push({ length: active.plays.length, correct: isCorrect })
    lastStats.value = saveLedgerResult({
      correct: isCorrect,
      assisted: answer.assisted,
      stage: active.stage,
      sequenceLength: active.plays.length
    })
    feedbackPulse.value += 1
    runtime.emitCue(isCorrect ? 'answer-correct' : 'answer-wrong', { balance: active.balance })
    runtime.later(dealNext, FEEDBACK_HOLD_MS)
  }

  function showLedger(): void {
    if (phase.peek() !== 'answering') return
    assistance.value = true
  }

  function endSession(): void {
    generation.current += 1
    if (!serverAnswers.current.length) {
      navigate(practiceLandingPath())
      return
    }
    recordSession()
    void gameRun.complete({ answers: serverAnswers.current })
    runtime.finish()
  }

  function replay(): void {
    track('game.replayed', 'practice:ledger')
    generation.current += 1
    serverAnswers.current = []
    gradedAnswers.current = []
    previousIds.current = new Set()
    checks.value = 0
    correct.value = 0
    assistedChecks.value = 0
    sequence.value = null
    runtime.reset('running')
    void gameRun.prepare()
  }

  // Match Trade's learned keyboard map: 1–4 are Blue (+1…+4), 6–9 are Red
  // (−1…−4), and 0 or 5 is Even.
  useGameKeys((event) => {
    if (phase.value !== 'answering') return
    const key = event.key
    if (key === '0' || key === '5') {
      event.preventDefault()
      guess(0)
      return
    }
    const n = Number(key)
    if (n >= 1 && n <= 4) {
      event.preventDefault()
      guess(n)
    } else if (n >= 6 && n <= 9) {
      event.preventDefault()
      guess(-(n - 5))
    }
  })

  if (!deck) return <GameRunGate modeName="Ledger" session={gameRun} />

  if (runtime.stage.value === 'summary') {
    const accuracy = checks.value ? Math.round((correct.value / checks.value) * 100) : 0
    const signature = ledgerSignature(
      gradedAnswers.current.map((g) => g.length),
      gradedAnswers.current.map((g) => g.correct)
    )
    return (
      <div class="ed-gamewrap">
        <Summary
          eyebrow="Ledger session"
          headline={`${correct.value} / ${checks.value} balances`}
          insights={computeInsights([])}
          moments={[
            { label: 'Accuracy', value: `${accuracy}%`, tone: accuracy >= 75 ? 'green' : 'purple' },
            { label: 'Without help', value: `${checks.value - assistedChecks.value}`, tone: 'gold' },
            { label: 'Next drill', value: stageLabel(ledgerStage(lastStats.value)) }
          ]}
          share={{ mode: 'practice', score: '' }}
          onReplay={replay}
          replayLabel="Keep tracking"
          onHome={() => navigate(practiceLandingPath())}
          homeLabel={practiceLandingPath() === '/practice' ? 'Practice' : 'Games'}
        >
          {signature.bars.length > 0 && <DrillPanel {...signature} />}
          <p class="ledger-summary__coach">
            {accuracy >= 80
              ? 'Your running count is holding. Longer sequences will arrive as the read stays clean.'
              : 'Keep the sign anchored: Red spends make Blue’s advantage grow; Blue spends pull it back.'}
          </p>
        </Summary>
      </div>
    )
  }

  const active = sequence.value
  if (!active || !gameRun.assetsReady) return <GameStartScreen modeName="Ledger" phase="loading" />
  const visible =
    active.stage === 'tracked'
      ? active.plays.slice(Math.max(0, revealed.value - 1), revealed.value)
      : active.plays.slice(0, revealed.value)
  const blue = visible.filter((play) => play.side === 'blue')
  const red = visible.filter((play) => play.side === 'red')
  const dealing = phase.value === 'dealing'
  const solved = phase.value === 'correct' || phase.value === 'wrong'
  const balanceVisible = solved || assistance.value || (dealing && active.stage === 'guided')
  const displayBalance = dealing ? runningBalance(active, revealed.value) : active.balance
  const answerBalance = active.balance
  const cardStats = getCardStats()
  const showCost = (cardId: number) =>
    active.stage === 'guided' || (active.stage === 'faded' && !isFluentCard(cardId, cardStats)) || solved

  function padStateFor(value: number): string {
    const classes: string[] = []
    if (picked.value === value) classes.push(phase.value === 'correct' ? 'is-correct' : 'is-wrong')
    if (solved && value === answerBalance) classes.push('is-answer')
    return classes.join(' ')
  }

  // The assist lives in the balance slot: while answering and not yet shown, the
  // `?` becomes a Reveal pill; tapping it fills the ledger line in place.
  const canReveal = phase.value === 'answering' && !assistance.value
  const redLane: LaneCard[] = red.map((play) => ({
    card: play.card,
    showCost: showCost(play.cardId),
    key: play.cardId
  }))
  const blueLane: LaneCard[] = blue.map((play) => ({
    card: play.card,
    showCost: showCost(play.cardId),
    key: play.cardId
  }))

  return (
    <GameFrame
      modeName="Ledger"
      counting={false}
      count={0}
      onQuit={endSession}
      quitLabel="End session"
      cue={runtime.cue.value}
      fxParticles={6}
      progressText={`${checks.value} checked · ${stageLabel(active.stage)}`}
      metric={{ value: String(correct.value), label: 'correct' }}
    >
      <div class="ledger">
        <ExchangeBoard
          stage={active.stage}
          red={redLane}
          blue={blueLane}
          balanceLabel={balanceWinner(displayBalance)}
          revealed={balanceVisible}
          onReveal={canReveal ? showLedger : undefined}
          trail={
            <div
              class="ledger-trail"
              role="progressbar"
              aria-label="Sequence progress"
              aria-valuemin={0}
              aria-valuemax={active.plays.length}
              aria-valuenow={revealed.value}
            >
              {active.plays.map((play, index) => (
                <span
                  key={`${play.cardId}-${index}`}
                  class={`ledger-trail__pip ledger-trail__pip--${play.side}${index < revealed.value ? ' is-played' : ''}`}
                />
              ))}
            </div>
          }
        />

        <div class="ledger-prompt" aria-live="polite">
          {dealing
            ? 'Keep a running count.'
            : solved
              ? exchangeSolvedLine(active.redTotal, active.blueTotal, active.balance)
              : EXCHANGE_PROMPT}
        </div>

        <ExchangePad
          answers={LEDGER_ANSWERS}
          onPick={(value) => guess(value)}
          disabled={phase.value !== 'answering'}
          stateFor={padStateFor}
        />

        <div class="game-cues" aria-hidden="true">
          <div class="game-cues__slot game-cues__slot--top">
            <FloatingCue
              trigger={feedbackPulse.value}
              className={phase.value === 'correct' ? '' : 'floating-cue--hint'}
            >
              {phase.value === 'correct' ? 'Count held!' : `Reset: ${formatLedgerBalance(active.balance)}`}
            </FloatingCue>
          </div>
        </div>
      </div>
    </GameFrame>
  )
}
