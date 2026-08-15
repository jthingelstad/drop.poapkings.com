import { useSignal } from '@preact/signals'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import type { Card, InputStyle } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import { pointerVerb } from '../../lib/use-layout'
import { makeChoices } from '../../lib/choices'
import { pickPracticeCard } from '../../lib/practice-deal'
import { saveResult, getCardStats, getSettings, saveSettings, recordSession } from '../../lib/storage'
import { computeInsights, weakestBandLabel } from '../../lib/insights'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import CardDisplay from '../../components/CardDisplay'
import PipKeypad from '../../components/PipKeypad'
import MultipleChoice from '../../components/MultipleChoice'
import FloatingCue from '../../components/FloatingCue'
import Icon from '../../components/Icon'
import Summary from '../../components/Summary'
import GameRunGate from '../../components/GameRunGate'
import GameMotion from '../../components/GameMotion'
import GameFrame from '../../components/game/GameFrame'
import GameStartScreen from '../../components/game/GameStart'
import { preloadGameFx } from '../../components/GameFxLayer'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'
import { useGameRuntime } from '../../lib/use-game-runtime'
import { track } from '../../lib/analytics'
import { preloadImages } from '../../lib/preload'

const ADVANCE_DELAY_CORRECT = 280
const WRONG_BEAT_MS = 430

interface Props {
  eyebrow: string
  onExit?: () => void
}

// A card on the table plus the 4-choice window rolled for it.
interface Hand {
  card: Card
  choices: number[]
}

// Card stats are re-read on every draw so the answer just given already counts
// toward the next one — a card missed right now is immediately hot again.
function draw(deck: readonly Card[], previousId: number | undefined): Hand | null {
  const next = pickPracticeCard(deck, getCardStats(), previousId)
  return next ? { card: next, choices: makeChoices(next.elixir) } : null
}

// Practice: the endless, untimed, non-competitive drill.
//
// It has no round length, no score, no record, and earns no Player XP — it
// touches nothing competitive or progressive on purpose, which is what buys it
// the freedom to be endless. The signed deck is the whole catalog used as a
// POOL: each card is drawn weighted by the player's own local card stats (see
// lib/practice-deal.ts), so the cards they keep missing come back. The session
// ends only when the player ends it, and closes on stats, never a result.
export default function PracticeLoop({ eyebrow, onExit }: Props) {
  const gameRun = useGameSession('practice', challengePreparers.practice)
  const runtime = useGameRuntime({ initialStage: 'running', guardActiveRun: false, trackElapsed: false })
  const exit = onExit ?? (() => navigate('/'))
  const answers = useRef<Answer[]>([])
  const serverAnswers = useRef<Array<{ cardId: number; guess: number }>>([])
  const recorded = useRef(false)
  // Invalidates an art handoff when the session ends, replays, or unmounts.
  // A late image callback must never deal into a different run.
  const handoffGeneration = useRef(0)
  const deck = gameRun.content

  const settings = getSettings()
  const inputStyle = useSignal<InputStyle>(settings.inputStyle)
  // One hand: the card on the table and its 4-choice window, re-rolled together
  // so a card that comes back around never reuses its old window.
  const dealt = useSignal<Hand | null>(null)
  const openingReadyId = useSignal<number | null>(null)
  const answered = useSignal(0)
  const phase = useSignal<'playing' | 'correct' | 'wrong'>('playing')
  const hint = useSignal<'higher' | 'lower' | null>(null)
  const hintPulse = useSignal(0)
  const streak = useSignal(0)
  // Bumped at streak milestones to fire the shared floating streak cue.
  const streakCue = useSignal(0)
  const correct = useSignal(0)
  const insights = useSignal<Insights | null>(null)

  useEffect(() => {
    preloadGameFx()
    return () => {
      handoffGeneration.current += 1
    }
  }, [])

  // The opening hand is DERIVED from the deck rather than dealt in an effect: an
  // effect would let one frame render with a resolved deck and nothing on the
  // table. Every later hand comes from deal().
  const opening = useMemo(() => draw(deck ?? [], undefined), [deck])
  const hand = dealt.value ?? opening

  // The opening draw is weighted from the whole catalog, not just the bounded
  // startup slice. Keep the unified loading surface up until that exact random
  // card is decoded; otherwise Practice can begin with the same pop-in that a
  // later random draw used to have.
  const openingCard = opening?.card
  const openingCardId = openingCard?.id
  useEffect(() => {
    if (!openingCard) return
    let active = true
    preloadImages([openingCard], () => {
      if (active) openingReadyId.value = openingCard.id
    })
    return () => {
      active = false
    }
  }, [openingCard, openingReadyId])

  function showHand(next: Hand): void {
    dealt.value = next
    recorded.current = false
    phase.value = 'playing'
    hint.value = null
  }

  function endSession() {
    handoffGeneration.current += 1
    const list = answers.current
    if (list.length === 0) {
      exit()
      return
    }
    insights.value = computeInsights(list)
    recordSession()
    // The run is still completed server-side: Practice writes no score, record,
    // or XP, but the validated transcript is what feeds the server-owned
    // learning stats.
    void gameRun.complete({ answers: serverAnswers.current })
    runtime.finish()
  }

  function handleAnswer(picked: number) {
    if (runtime.stage.value !== 'running' || phase.value !== 'playing') return

    const current = hand?.card
    if (!current) return
    const isCorrect = picked === current.elixir

    // Practice grades the first read, like Surge, but lets the player keep
    // trying the same card until they solve it. The server receives one
    // canonical answer per question.
    if (!recorded.current) {
      recorded.current = true
      saveResult(current.id, isCorrect)
      answers.current.push({ card: current, guess: picked, correct: isCorrect })
      serverAnswers.current.push({ cardId: current.id, guess: picked })
      answered.value++

      if (isCorrect) {
        correct.value++
        streak.value++
        if (streak.value === 3 || (streak.value > 3 && streak.value % 5 === 0)) streakCue.value++
      } else {
        streak.value = 0
      }
    }

    if (isCorrect) {
      playCorrect()
      phase.value = 'correct'
      hint.value = null
      runtime.emitCue('answer-correct', { cardId: current.id })
      // The next weighted draw is unknowable at startup, so prepare it now and
      // keep the solved hand on screen until BOTH the feedback beat and browser
      // image decode have finished. This makes the name/art swap atomic even
      // when the service worker already had the response bytes cached.
      const next = draw(deck ?? [], current.id)
      const generation = ++handoffGeneration.current
      let beatReady = false
      let artReady = false
      const advance = () => {
        if (!next || !beatReady || !artReady || generation !== handoffGeneration.current) return
        if (runtime.stage.value !== 'running') return
        showHand(next)
        runtime.emitCue('round-advance', { cardId: next.card.id })
      }
      if (next) {
        preloadImages([next.card], () => {
          artReady = true
          advance()
        })
      }
      runtime.later(() => {
        beatReady = true
        advance()
      }, ADVANCE_DELAY_CORRECT)
    } else {
      playWrong()
      hint.value = picked < current.elixir ? 'higher' : 'lower'
      hintPulse.value++
      phase.value = 'wrong'
      runtime.emitCue('answer-wrong', { cardId: current.id })
      runtime.later(() => (phase.value = 'playing'), WRONG_BEAT_MS)
    }
  }

  function replay() {
    track('game.replayed', 'practice')
    runtime.reset('running')
    answers.current = []
    serverAnswers.current = []
    answered.value = 0
    correct.value = 0
    streak.value = 0
    insights.value = null
    recorded.current = false
    phase.value = 'playing'
    hint.value = null
    handoffGeneration.current += 1
    // Fall back to the opening hand so the board is never empty for a frame,
    // then ask for a fresh signed run — its deck derives a new opening.
    dealt.value = null
    void gameRun.prepare()
  }

  function switchInput(style: InputStyle) {
    inputStyle.value = style
    saveSettings({ inputStyle: style })
  }

  if (!deck) return <GameRunGate modeName="Practice" session={gameRun} />

  if (runtime.stage.value === 'summary' && insights.value) {
    const ins = insights.value
    const focus = weakestBandLabel(ins)
    return (
      <div class="ed-gamewrap">
        <Summary
          eyebrow={eyebrow}
          headline={`${ins.correct} / ${ins.total} · ${ins.accuracyPct}%`}
          insights={ins}
          // Session stats only — Practice has no score, no best, and no record
          // to call out.
          moments={[
            { label: 'Answered', value: `${ins.total}` },
            { label: 'Accuracy', value: `${ins.accuracyPct}%`, tone: 'green' },
            { label: 'Next drill', value: focus ?? 'Clean read', tone: focus ? 'purple' : 'green' }
          ]}
          share={{ mode: 'practice', score: `${ins.correct}/${ins.total} · ${ins.accuracyPct}%` }}
          onReplay={replay}
          replayLabel="Practice again"
          onHome={exit}
        />
      </div>
    )
  }

  if (!gameRun.assetsReady || (dealt.value === null && openingReadyId.value !== openingCardId)) {
    return <GameStartScreen modeName="Practice" phase="loading" />
  }
  if (!hand) return <GameRunGate modeName="Practice" session={gameRun} />
  const current = hand.card

  return (
    <GameFrame
      modeName="Practice"
      counting={false}
      count={0}
      onQuit={endSession}
      quitLabel="End session"
      cue={runtime.cue.value}
      fxParticles={6}
      // Endless: there is no "card 7 of N" to count toward, so the bar and the
      // progress line carry the only two live session facts instead.
      progressText={`${answered.value} answered`}
      metric={{ value: String(correct.value), label: 'correct' }}
      progressPct={answered.value > 0 ? (correct.value / answered.value) * 100 : 0}
    >
      <div class="ed-kstage ed-kstage--practice">
        <div class="ed-kstage__card">
          <GameMotion contentKey={current.id} cue={runtime.cue.value}>
            <CardDisplay card={current} phase={phase.value} revealCost={false} />
          </GameMotion>
        </div>

        <div class="ed-kstage__hint">{pointerVerb()} the elixir cost</div>
        <div class="input-toggle">
          <button
            class={`input-toggle__btn${inputStyle.value === 'keypad' ? ' input-toggle__btn--active' : ''}`}
            onClick={() => switchInput('keypad')}
            aria-pressed={inputStyle.value === 'keypad'}
          >
            Keypad
          </button>
          <button
            class={`input-toggle__btn${inputStyle.value === 'choice' ? ' input-toggle__btn--active' : ''}`}
            onClick={() => switchInput('choice')}
            aria-pressed={inputStyle.value === 'choice'}
          >
            4 choices
          </button>
        </div>

        {inputStyle.value === 'keypad' ? (
          <PipKeypad onPick={handleAnswer} disabled={phase.value !== 'playing' || gameRun.preparing.value} />
        ) : (
          <MultipleChoice
            choices={hand.choices}
            onPick={handleAnswer}
            disabled={phase.value !== 'playing' || gameRun.preparing.value}
          />
        )}

        {/* Shared floating streak cue — composited, never in layout flow. */}
        <div class="game-cues" aria-hidden="true">
          <div class="game-cues__slot game-cues__slot--top">
            <FloatingCue trigger={streakCue.value} className="floating-cue--streak">
              🔥 {streak.value} streak
            </FloatingCue>
          </div>
          <div class="game-cues__slot game-cues__slot--bottom">
            <FloatingCue trigger={hintPulse.value} className="floating-cue--hint" testId="practice-hint">
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
          {phase.value === 'wrong' && hint.value ? (hint.value === 'higher' ? 'Higher' : 'Lower') : ''}
        </span>
      </div>
    </GameFrame>
  )
}
