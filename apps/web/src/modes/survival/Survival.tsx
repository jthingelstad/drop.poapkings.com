import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { survivalWindowMs } from '@elixir-drop/contracts'
import type { Card } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import { saveResult, getRecords, saveRecords } from '../../lib/storage'
import { computeInsights } from '../../lib/insights'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { preloadImages } from '../../lib/preload'
import { useGameRuntime } from '../../lib/use-game-runtime'
import CardDisplay from '../../components/CardDisplay'
import PipKeypad from '../../components/PipKeypad'
import Summary from '../../components/Summary'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'
import GameRunGate from '../../components/GameRunGate'
import RunScopeBadge from '../../components/RunScopeBadge'
import GameMotion from '../../components/GameMotion'
import GameFxLayer, { preloadGameFx } from '../../components/GameFxLayer'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'

// Survival = sudden death. Each card has a short clock that tightens as the
// streak grows (shared curve with the server scorer); a miss OR a timeout ends
// the run. Score is how many you clear in a row.
const DEATH_BEAT_MS = 1100

export default function Survival() {
  const gameRun = useGameSession('survival', challengePreparers.survival)
  const answers = useRef<Answer[]>([])
  const cardStart = useRef(0)
  const dead = useRef(false)
  const serverCardIndex = useRef(0)
  const serverAnswers = useRef<Array<{ cardId: number; guess: number | null; elapsedMs: number }>>([])

  const runtime = useGameRuntime()
  const { stage, later } = runtime
  const streak = useSignal(0)
  const best = useSignal(getRecords().survivalBest ?? 0)
  const remainingFrac = useSignal(1)
  const current = useSignal<Card | null>(null)
  const cardPhase = useSignal<'playing' | 'correct' | 'wrong'>('playing')
  const dropKey = useSignal(0)

  const insights = useSignal<Insights | null>(null)
  const isPB = useSignal(false)
  const elixirLine = useSignal('')
  const dieRef = useRef<(card: Card | null, picked: number | undefined) => void>(() => {})
  dieRef.current = die

  useEffect(() => {
    track('mode.survival')
    preloadGameFx()
  }, [])

  // Sudden death cannot pause (that would be free thinking time), so leaving
  // the tab ends the run right away with the streak intact — instead of the
  // old behavior where the clock kept running while hidden and the first
  // frame after returning executed the death.
  useEffect(() => {
    if (stage.value !== 'running') return
    const onHidden = () => {
      if (document.visibilityState === 'hidden') dieRef.current(current.value, undefined)
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [current, stage.value])

  // Per-card clock — drives the depleting bar and times you out. The window
  // shrinks as the streak grows, so deep runs end at the player's true speed
  // ceiling instead of by boredom or a lapse.
  useEffect(() => {
    if (stage.value !== 'running') return
    let raf = 0
    const loop = () => {
      if (cardPhase.value === 'playing') {
        const elapsed = performance.now() - cardStart.current
        const frac = 1 - elapsed / survivalWindowMs(streak.value)
        remainingFrac.value = Math.max(0, frac)
        if (frac <= 0) {
          dieRef.current(current.value, undefined)
          return
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [cardPhase, current, remainingFrac, stage.value, streak])

  async function begin() {
    if (!(await gameRun.ensureFreshRun())) return
    runtime.startNow((startedAt) => {
      dead.current = false
      answers.current = []
      serverAnswers.current = []
      streak.value = 0
      current.value = gameRun.content?.[0] ?? null
      serverCardIndex.current = current.value ? 1 : 0
      cardStart.current = startedAt
      remainingFrac.value = 1
      cardPhase.value = 'playing'
    })
  }

  function nextCard() {
    if (stage.value !== 'running' || dead.current) return
    const c = gameRun.content?.[serverCardIndex.current]
    if (!c) {
      finish()
      return
    }
    serverCardIndex.current += 1
    current.value = c
    cardStart.current = performance.now()
    remainingFrac.value = 1
    cardPhase.value = 'playing'
    preloadImages([c], () => {})
    runtime.emitCue('round-advance', { cardId: c.id })
  }

  // death by a wrong guess (picked set) or a timeout (picked undefined)
  function die(card: Card | null, picked: number | undefined) {
    if (dead.current) return
    dead.current = true
    playWrong()
    if (card) {
      serverAnswers.current.push({
        cardId: card.id,
        guess: picked ?? null,
        elapsedMs: performance.now() - cardStart.current
      })
      answers.current.push({ card, guess: picked ?? card.elixir, correct: false })
      saveResult(card.id, false)
    }
    cardPhase.value = 'wrong'
    remainingFrac.value = 0
    runtime.emitCue('answer-wrong', { cardId: card?.id, timeout: picked === undefined })
    later(finish, DEATH_BEAT_MS)
  }

  function finish() {
    const ins = computeInsights(answers.current)
    const prev = getRecords().survivalBest
    const pb = streak.value > (prev ?? 0)

    insights.value = ins
    isPB.value = pb
    if (pb) {
      saveRecords({ survivalBest: streak.value })
      best.value = streak.value
      track('record.new')
    }
    elixirLine.value = pb
      ? `${streak.value} in a row — new best. That's nerve.`
      : `${streak.value} in a row. The clan goes deeper. Run it back.`
    runtime.finish('over')
    void gameRun.complete({ answers: serverAnswers.current })
  }

  function answer(picked: number) {
    if (stage.value !== 'running' || cardPhase.value !== 'playing' || dead.current) return
    const card = current.value
    if (!card) return

    if (picked === card.elixir) {
      playCorrect()
      const ms = performance.now() - cardStart.current
      serverAnswers.current.push({ cardId: card.id, guess: picked, elapsedMs: ms })
      answers.current.push({ card, guess: picked, correct: true, ms })
      saveResult(card.id, true, ms)
      streak.value += 1
      cardPhase.value = 'correct'
      dropKey.value += 1
      runtime.emitCue('answer-correct', { cardId: card.id })
      later(nextCard, 230)
    } else {
      die(card, picked)
    }
  }

  function replay() {
    runtime.reset('ready')
    dead.current = false
    insights.value = null
    current.value = null
    serverCardIndex.current = 0
    serverAnswers.current = []
    cardPhase.value = 'playing'
    streak.value = 0
    remainingFrac.value = 1
    void gameRun.prepare()
  }

  // ── Game over ──────────────────────────────────────────────────────────────
  if (!gameRun.content) {
    return (
      <GameRunGate preparing={gameRun.preparing.value} error={gameRun.error} onRetry={() => void gameRun.prepare()} />
    )
  }

  if (stage.value === 'over' && insights.value) {
    const pbCallout = isPB.value ? 'New personal best!' : best.value > 0 ? `Best: ${best.value}` : undefined
    return (
      <div class="main-content">
        <Summary
          eyebrow="Survival · sudden death"
          headline={`${streak.value} in a row`}
          pbCallout={pbCallout}
          elixirLine={elixirLine.value}
          elixirMood={isPB.value ? 'hype' : 'unimpressed'}
          insights={insights.value}
          onReplay={replay}
          replayLabel="Run it back"
          onHome={() => navigate('/')}
        >
          <ShareLine text={`Survival: ${streak.value} in a row — drop.poapkings.com`} />
          {isPB.value && streak.value >= 10 && <Recruit />}
        </Summary>
      </div>
    )
  }

  // ── Get ready ────────────────────────────────────────────────────────────
  if (stage.value === 'ready') {
    return (
      <div class="main-content surge">
        <div class="surge-ready">
          <div class="eyebrow">Survival · sudden death</div>
          <h1 class="h1">One miss ends it.</h1>
          <p class="lede">
            Name each cost before the bar runs out. A wrong tap or a timeout — and the run's over. How deep can you go?
          </p>
          <RunScopeBadge ranked={gameRun.ranked.value} />
          <button
            class="btn btn--gold surge-ready__go"
            onClick={begin}
            disabled={!gameRun.assetsReady || gameRun.preparing.value}
          >
            {gameRun.assetsReady ? 'Start run' : 'Loading cards…'}
          </button>
          <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
            Back
          </button>
        </div>
      </div>
    )
  }

  // ── Running ──────────────────────────────────────────────────────────────
  const card = current.value
  const low = remainingFrac.value <= 0.35
  return (
    <div class="main-content game-run surge">
      <GameFxLayer cue={runtime.cue.value} particleCount={10} />
      <div class="surge-hud">
        <div class="surge-hud__timer">{streak.value}</div>
        <div class="surge-hud__count">streak · best {best.value}</div>
      </div>

      <div class="progress-track" aria-hidden="true">
        <div
          class={`progress-track__fill${low ? ' progress-track__fill--low' : ''}`}
          style={{ width: `${remainingFrac.value * 100}%`, transition: 'none' }}
        />
      </div>

      {card && (
        <GameMotion contentKey={card.id} cue={runtime.cue.value}>
          <CardDisplay
            card={card}
            phase={cardPhase.value}
            dropAnimKey={dropKey.value}
            revealCost={cardPhase.value === 'wrong'}
          />
        </GameMotion>
      )}

      <PipKeypad onPick={answer} disabled={cardPhase.value !== 'playing'} />
    </div>
  )
}
