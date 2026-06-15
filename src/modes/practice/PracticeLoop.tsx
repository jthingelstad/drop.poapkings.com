import { useSignal } from '@preact/signals'
import { useRef } from 'preact/hooks'
import type { Card, ElixirMood, InputStyle } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import { sampleUnseenCard } from '../../lib/sampling'
import { makeChoices } from '../../lib/choices'
import { saveResult, getSettings, saveSettings, recordSession, getRecords, saveRecords } from '../../lib/storage'
import { computeInsights, insightPhrase } from '../../lib/insights'
import { pickLine } from '../../lib/elixir-lines'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import CardDisplay from '../../components/CardDisplay'
import PipKeypad from '../../components/PipKeypad'
import MultipleChoice from '../../components/MultipleChoice'
import ElixirHost from '../../components/ElixirHost'
import Summary from '../../components/Summary'
import Recruit from '../../components/Recruit'

const STRONG_SESSION_PCT = 85
const ROUND_LEN = 15
const ADVANCE_DELAY_CORRECT = 1100
const ADVANCE_DELAY_WRONG = 1500

interface Props {
  pool: Card[]
  eyebrow: string
  onExit?: () => void
}

// The untimed quiz loop used by Practice.
export default function PracticeLoop({ pool, eyebrow, onExit }: Props) {
  const exit = onExit ?? (() => navigate('/'))
  const lastSeen = useRef<number[]>([])
  const seen = useRef<Set<number>>(new Set())
  const answers = useRef<Answer[]>([])

  const settings = getSettings()
  const inputStyle = useSignal<InputStyle>(settings.inputStyle)
  const view = useSignal<'play' | 'summary'>('play')
  const initialCard = useRef<Card | null>(null)
  if (!initialCard.current) initialCard.current = drawCard()
  const currentCard = useSignal<Card>(initialCard.current!)
  const choices = useSignal<number[]>(makeChoices(currentCard.value.elixir))
  const phase = useSignal<'playing' | 'correct' | 'wrong'>('playing')
  const elixirLine = useSignal<string>(pickLine('idle'))
  const elixirMood = useSignal<ElixirMood>('neutral')
  const dropKey = useSignal(0)
  const streak = useSignal(0)
  const answered = useSignal(0)
  const correct = useSignal(0)
  const insights = useSignal<Insights | null>(null)
  const strongSession = useSignal(false)

  function drawCard(): Card {
    const next = sampleUnseenCard(pool, seen.current, lastSeen.current)
    lastSeen.current = [...lastSeen.current.slice(-5), next.id]
    return next
  }

  function nextCard() {
    const next = drawCard()
    currentCard.value = next
    choices.value = makeChoices(next.elixir)
    phase.value = 'playing'
    elixirLine.value = ''
    elixirMood.value = 'thinking'
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
      const prev = getRecords().bestAccuracy ?? 0
      if (ins.accuracyPct > prev) saveRecords({ bestAccuracy: ins.accuracyPct })
    }

    strongSession.value = complete && ins.total >= 10 && ins.accuracyPct >= STRONG_SESSION_PCT

    const good = ins.accuracyPct >= 80
    elixirLine.value = pickLine('session_end', { accuracy: ins.accuracyPct, insight: insightPhrase(ins) })
    elixirMood.value = good ? 'trophy' : 'neutral'
    view.value = 'summary'
  }

  function handleAnswer(picked: number) {
    if (phase.value !== 'playing') return

    const card = currentCard.value
    const isCorrect = picked === card.elixir

    saveResult(card.id, isCorrect)
    answers.current.push({ card, guess: picked, correct: isCorrect })
    answered.value++

    if (isCorrect) {
      playCorrect()
      correct.value++
      streak.value++
      dropKey.value++
      phase.value = 'correct'
      const event = streak.value >= 3 ? 'correct_streak' : 'correct_fast'
      elixirLine.value = pickLine(event, { n: streak.value })
      elixirMood.value = streak.value >= 3 ? 'celebrate' : 'happy'
    } else {
      playWrong()
      streak.value = 0
      phase.value = 'wrong'
      const diff = Math.abs(picked - card.elixir)
      elixirLine.value = pickLine(diff <= 1 ? 'wrong_close' : 'wrong_far')
      elixirMood.value = diff <= 1 ? 'angry' : 'facepalm'
    }

    const isLast = answered.value >= ROUND_LEN
    const delay = isCorrect ? ADVANCE_DELAY_CORRECT : ADVANCE_DELAY_WRONG
    setTimeout(() => (isLast ? finishRound(true) : nextCard()), delay)
  }

  function replay() {
    answers.current = []
    lastSeen.current = []
    seen.current.clear()
    answered.value = 0
    correct.value = 0
    streak.value = 0
    insights.value = null
    elixirLine.value = pickLine('idle')
    elixirMood.value = 'thinking'
    phase.value = 'playing'
    nextCard()
    view.value = 'play'
  }

  function switchInput(style: InputStyle) {
    inputStyle.value = style
    saveSettings({ inputStyle: style })
  }

  if (view.value === 'summary' && insights.value) {
    const ins = insights.value
    return (
      <div class="main-content">
        <Summary
          eyebrow={eyebrow}
          headline={`${ins.correct} / ${ins.total} · ${ins.accuracyPct}%`}
          elixirLine={elixirLine.value}
          elixirMood={elixirMood.value}
          insights={ins}
          onReplay={replay}
          onHome={exit}
        >
          {strongSession.value && <Recruit />}
        </Summary>
      </div>
    )
  }

  const accuracy = answered.value > 0 ? Math.round((correct.value / answered.value) * 100) : null

  return (
    <div class="main-content game-run" style={{ alignItems: 'center', gap: 24 }}>
      <div class="session-bar">
        <div class="session-bar__stat">
          <span class="session-bar__val">
            {Math.min(answered.value + 1, ROUND_LEN)}
            <span class="session-bar__sep"> / {ROUND_LEN}</span>
          </span>
          <span>card</span>
        </div>
        {accuracy !== null && (
          <div class="session-bar__stat">
            <span class="session-bar__val">{accuracy}%</span>
            <span>accuracy</span>
          </div>
        )}
        {streak.value >= 3 && (
          <div class="session-bar__stat">
            <span class="session-bar__val">{streak.value}</span>
            <span>🔥 streak</span>
          </div>
        )}
        <button class="session-bar__end" onClick={() => finishRound(false)}>
          End round
        </button>
      </div>

      <div class="progress-track" aria-hidden="true">
        <div class="progress-track__fill" style={{ width: `${(answered.value / ROUND_LEN) * 100}%` }} />
      </div>

      <CardDisplay card={currentCard.value} phase={phase.value} dropAnimKey={dropKey.value} />

      <div style={{ textAlign: 'center' }}>
        <p class="lede" style={{ fontSize: '1.0rem', marginBottom: 4 }}>
          How much elixir does this cost?
        </p>
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
      </div>

      {inputStyle.value === 'keypad' ? (
        <PipKeypad onPick={handleAnswer} disabled={phase.value !== 'playing'} />
      ) : (
        <MultipleChoice choices={choices.value} onPick={handleAnswer} disabled={phase.value !== 'playing'} />
      )}

      <ElixirHost line={elixirLine.value} mood={elixirMood.value} />
    </div>
  )
}
