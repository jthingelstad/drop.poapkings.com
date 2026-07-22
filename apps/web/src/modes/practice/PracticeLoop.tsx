import { useSignal } from '@preact/signals'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import type { InputStyle } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import { makeChoices } from '../../lib/choices'
import { saveResult, getSettings, saveSettings, recordSession } from '../../lib/storage'
import { computeInsights } from '../../lib/insights'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import CardDisplay from '../../components/CardDisplay'
import PipKeypad from '../../components/PipKeypad'
import MultipleChoice from '../../components/MultipleChoice'
import FloatingCue from '../../components/FloatingCue'
import Summary from '../../components/Summary'
import Recruit from '../../components/Recruit'
import GameRunGate from '../../components/GameRunGate'
import GameMotion from '../../components/GameMotion'
import GameFrame from '../../components/game/GameFrame'
import { preloadGameFx } from '../../components/GameFxLayer'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'
import { useGameRuntime } from '../../lib/use-game-runtime'

const STRONG_SESSION_PCT = 85
const ROUND_LEN = 15
const ADVANCE_DELAY_CORRECT = 1100
const ADVANCE_DELAY_WRONG = 1500

interface Props {
  eyebrow: string
  onExit?: () => void
}

// The untimed quiz loop used by Practice.
export default function PracticeLoop({ eyebrow, onExit }: Props) {
  const gameRun = useGameSession('practice', challengePreparers.practice)
  const runtime = useGameRuntime({ initialStage: 'running', guardActiveRun: false, trackElapsed: false })
  const exit = onExit ?? (() => navigate('/'))
  const answers = useRef<Answer[]>([])
  const serverAnswers = useRef<Array<{ cardId: number; guess: number }>>([])
  const cards = gameRun.content
  const choiceSets = useMemo(() => cards?.map((card) => makeChoices(card.elixir)) ?? [], [cards])

  const settings = getSettings()
  const inputStyle = useSignal<InputStyle>(settings.inputStyle)
  const cardIndex = useSignal(0)
  const phase = useSignal<'playing' | 'correct' | 'wrong'>('playing')
  const dropKey = useSignal(0)
  const streak = useSignal(0)
  // Bumped at streak milestones to fire the shared floating streak cue.
  const streakCue = useSignal(0)
  const answered = useSignal(0)
  const correct = useSignal(0)
  const insights = useSignal<Insights | null>(null)
  const strongSession = useSignal(false)

  useEffect(() => {
    preloadGameFx()
  }, [])

  function nextCard() {
    const nextIndex = cardIndex.value + 1
    if (!cards?.[nextIndex]) return
    cardIndex.value = nextIndex
    phase.value = 'playing'
    runtime.emitCue('round-advance', { cardId: cards[nextIndex]?.id })
  }

  function finishRound(complete: boolean) {
    const list = answers.current
    if (list.length === 0) {
      exit()
      return
    }
    const ins = computeInsights(list)
    insights.value = ins
    recordSession()

    if (complete) {
      // bestAccuracy is persisted centrally when the server accepts the run.
      void gameRun.complete({ answers: serverAnswers.current })
    }

    strongSession.value = complete && ins.total >= 10 && ins.accuracyPct >= STRONG_SESSION_PCT

    runtime.finish()
  }

  function handleAnswer(picked: number) {
    if (runtime.stage.value !== 'running' || phase.value !== 'playing') return

    const card = cards?.[cardIndex.value]
    if (!card) return
    const isCorrect = picked === card.elixir

    saveResult(card.id, isCorrect)
    answers.current.push({ card, guess: picked, correct: isCorrect })
    serverAnswers.current.push({ cardId: card.id, guess: picked })
    answered.value++

    if (isCorrect) {
      playCorrect()
      correct.value++
      streak.value++
      dropKey.value++
      if (streak.value === 3 || (streak.value > 3 && streak.value % 5 === 0)) streakCue.value++
      phase.value = 'correct'
      runtime.emitCue('answer-correct', { cardId: card.id })
    } else {
      playWrong()
      streak.value = 0
      phase.value = 'wrong'
      runtime.emitCue('answer-wrong', { cardId: card.id })
    }

    const isLast = answered.value >= ROUND_LEN
    const delay = isCorrect ? ADVANCE_DELAY_CORRECT : ADVANCE_DELAY_WRONG
    runtime.later(() => (isLast ? finishRound(true) : nextCard()), delay)
  }

  function replay() {
    runtime.reset('running')
    answers.current = []
    serverAnswers.current = []
    cardIndex.value = 0
    void gameRun.prepare()
    answered.value = 0
    correct.value = 0
    streak.value = 0
    insights.value = null
    phase.value = 'playing'
  }

  function switchInput(style: InputStyle) {
    inputStyle.value = style
    saveSettings({ inputStyle: style })
  }

  if (!cards) {
    return (
      <GameRunGate preparing={gameRun.preparing.value} error={gameRun.error} onRetry={() => void gameRun.prepare()} />
    )
  }

  if (runtime.stage.value === 'summary' && insights.value) {
    const ins = insights.value
    return (
      <div class="ed-gamewrap">
        <Summary
          eyebrow={eyebrow}
          headline={`${ins.correct} / ${ins.total} · ${ins.accuracyPct}%`}
          insights={ins}
          moments={[
            { label: 'Correct', value: `${ins.correct}/${ins.total}` },
            { label: 'Accuracy', value: `${ins.accuracyPct}%`, tone: 'green' },
            { label: 'Mode', value: 'Unranked', tone: 'purple' }
          ]}
          onReplay={replay}
          onHome={exit}
        >
          {strongSession.value && <Recruit />}
        </Summary>
      </div>
    )
  }

  const card = cards[cardIndex.value]!

  return (
    <GameFrame
      modeName="Practice"
      counting={false}
      count={0}
      onQuit={exit}
      cue={runtime.cue.value}
      fxParticles={6}
      progressText={`Card ${Math.min(answered.value + 1, ROUND_LEN)} / ${ROUND_LEN}`}
      metric={{ value: String(correct.value), label: 'correct' }}
      progressPct={(answered.value / ROUND_LEN) * 100}
    >
      <div class="ed-kstage">
        <div class="ed-kstage__card">
          <GameMotion contentKey={card.id} cue={runtime.cue.value} preset="reveal">
            <CardDisplay card={card} phase={phase.value} dropAnimKey={dropKey.value} />
          </GameMotion>
        </div>

        <div class="ed-kstage__hint">Tap the elixir cost</div>
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
            choices={choiceSets[cardIndex.value] ?? []}
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
        </div>
      </div>
    </GameFrame>
  )
}
