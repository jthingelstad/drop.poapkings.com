import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { survivalWindowMs } from '@elixir-drop/contracts'
import type { Card } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import { saveResult, getRecords } from '../../lib/storage'
import { computeInsights } from '../../lib/insights'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { preloadImages } from '../../lib/preload'
import { useGameRuntime } from '../../lib/use-game-runtime'
import CardDisplay from '../../components/CardDisplay'
import FloatingCue from '../../components/FloatingCue'
import PipKeypad from '../../components/PipKeypad'
import Summary from '../../components/Summary'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'
import GameRunGate from '../../components/GameRunGate'
import GameMotion from '../../components/GameMotion'
import GameFxLayer, { preloadGameFx } from '../../components/GameFxLayer'
import RunCountdown from '../../components/RunCountdown'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'

// Survival = sudden death. Each card has a short clock that tightens as the
// streak grows (shared curve with the server scorer); a miss OR a timeout ends
// the run. Score is how many you clear in a row.
const DEATH_BEAT_MS = 1100
// A 3-2-1 before the first card so the per-card clock never starts while the
// player is still orienting — the sudden-death clock only begins once counting
// ends. Matches Surge's cadence.
const COUNTDOWN_STEP_MS = 650

export default function Survival() {
  const gameRun = useGameSession('survival', challengePreparers.survival)
  const answers = useRef<Answer[]>([])
  const cardStart = useRef(0)
  const dead = useRef(false)
  const serverCardIndex = useRef(0)
  const serverAnswers = useRef<Array<{ cardId: number; guess: number | null; elapsedMs: number }>>([])

  const runtime = useGameRuntime({ countdownStepMs: COUNTDOWN_STEP_MS })
  const { stage, count, later } = runtime
  const streak = useSignal(0)
  const streakCue = useSignal(0)
  const best = useSignal(getRecords().survivalBest ?? 0)
  const remainingFrac = useSignal(1)
  const current = useSignal<Card | null>(null)
  const cardPhase = useSignal<'playing' | 'correct' | 'wrong'>('playing')
  const dropKey = useSignal(0)

  const insights = useSignal<Insights | null>(null)
  const isPB = useSignal(false)
  // Set when the whole deck is cleared — a win, not a death.
  const won = useRef(false)
  const finishTimeMs = useSignal(0)
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
    runtime.start((startedAt) => {
      dead.current = false
      won.current = false
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
      // Cleared the whole deck — a win.
      won.current = true
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
    // Cumulative time across the surviving cards — matches the server's tiebreak.
    finishTimeMs.value = serverAnswers.current.slice(0, streak.value).reduce((sum, entry) => sum + entry.elapsedMs, 0)
    if (pb) {
      // Live display only; survivalBest is persisted centrally on acceptance.
      best.value = streak.value
      track('record.new')
    }
    if (won.current) {
      track('survival.win')
    }
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
      if (streak.value === 3 || (streak.value > 3 && streak.value % 5 === 0)) streakCue.value += 1
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
    won.current = false
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
    const winTime = `${(finishTimeMs.value / 1000).toFixed(2)}s`
    const pbCallout = won.current
      ? `Cleared in ${winTime}`
      : isPB.value
        ? 'New personal best!'
        : best.value > 0
          ? `Best: ${best.value}`
          : undefined
    return (
      <div class="main-content">
        <Summary
          eyebrow={won.current ? 'Survival · cleared!' : 'Survival · sudden death'}
          headline={won.current ? 'You named every card!' : `${streak.value} in a row`}
          pbCallout={pbCallout}
          insights={insights.value}
          onReplay={replay}
          replayLabel={won.current ? 'Go faster' : 'Run it back'}
          onHome={() => navigate('/')}
        >
          <ShareLine
            text={
              won.current
                ? `Survival: named every card in ${winTime} — drop.poapkings.com`
                : `Survival: ${streak.value} in a row — drop.poapkings.com`
            }
          />
          {(won.current || (isPB.value && streak.value >= 10)) && <Recruit />}
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

  // ── Countdown + Running ──────────────────────────────────────────────────
  // The interface is drawn for the countdown too: the 3-2-1 ticks down in the
  // card's slot (the first card is present but hidden, reserving its height), and
  // the per-card clock stays full until the first card lands.
  const counting = stage.value === 'countdown'
  const card = counting ? gameRun.content[0]! : current.value
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

      <div class={`run-stage${counting ? ' run-stage--counting' : ''}`}>
        {card && (
          <GameMotion contentKey={counting ? 'ready' : card.id} cue={runtime.cue.value}>
            <CardDisplay
              card={card}
              phase={cardPhase.value}
              dropAnimKey={dropKey.value}
              revealCost={cardPhase.value === 'wrong'}
            />
          </GameMotion>
        )}
        {counting && <RunCountdown count={count.value} />}
      </div>

      <PipKeypad onPick={answer} disabled={counting || cardPhase.value !== 'playing'} />

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
