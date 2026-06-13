import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card, ElixirMood, InputStyle } from '../../types'
import type { CardsData } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import rawCards from '../../data/cards.json'
import { sampleCard } from '../../lib/sampling'
import { makeChoices } from '../../lib/choices'
import { saveResult, getSettings, saveSettings, recordSession, getRecords, saveRecords } from '../../lib/storage'
import { computeInsights, insightPhrase } from '../../lib/insights'
import { pickLine } from '../../lib/elixir-lines'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import CardDisplay from '../../components/CardDisplay'
import PipKeypad from '../../components/PipKeypad'
import MultipleChoice from '../../components/MultipleChoice'
import ElixirHost from '../../components/ElixirHost'
import Summary from '../../components/Summary'
import Recruit from '../../components/Recruit'

const STRONG_SESSION_PCT = 85

const cardsData = rawCards as CardsData
const ALL_CARDS = cardsData.cards

const PRACTICE_ROUND_LEN = 15
const ADVANCE_DELAY_CORRECT = 1100
const ADVANCE_DELAY_WRONG = 1500

export default function Practice() {
  const lastSeen = useRef<number[]>([])
  const answers = useRef<Answer[]>([])

  const settings = getSettings()
  const inputStyle = useSignal<InputStyle>(settings.inputStyle)
  const view = useSignal<'play' | 'summary'>('play')
  const currentCard = useSignal<Card>(sampleCard(ALL_CARDS, lastSeen.current))
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

  useEffect(() => {
    track('mode.practice')
  }, [])

  function nextCard() {
    const next = sampleCard(ALL_CARDS, lastSeen.current)
    lastSeen.current = [...lastSeen.current.slice(-5), next.id]
    currentCard.value = next
    choices.value = makeChoices(next.elixir)
    phase.value = 'playing'
    elixirLine.value = ''
    elixirMood.value = 'neutral'
  }

  function finishRound(complete: boolean) {
    const list = answers.current
    if (list.length === 0) {
      navigate('/')
      return
    }
    const ins = computeInsights(list)
    insights.value = ins
    recordSession()

    // Only full rounds count toward the best-accuracy record (recruit trigger).
    if (complete) {
      const prev = getRecords().bestAccuracy ?? 0
      if (ins.accuracyPct > prev) saveRecords({ bestAccuracy: ins.accuracyPct })
    }

    // Earned moment: a full round read cleanly enough to be worth an ask.
    strongSession.value = complete && ins.total >= 10 && ins.accuracyPct >= STRONG_SESSION_PCT

    const good = ins.accuracyPct >= 80
    elixirLine.value = pickLine('session_end', { accuracy: ins.accuracyPct, insight: insightPhrase(ins) })
    elixirMood.value = good ? 'hype' : 'neutral'
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
      elixirMood.value = 'hype'
    } else {
      playWrong()
      streak.value = 0
      phase.value = 'wrong'
      const diff = Math.abs(picked - card.elixir)
      elixirLine.value = pickLine(diff <= 1 ? 'wrong_close' : 'wrong_far')
      elixirMood.value = 'unimpressed'
    }

    const isLast = answered.value >= PRACTICE_ROUND_LEN
    const delay = isCorrect ? ADVANCE_DELAY_CORRECT : ADVANCE_DELAY_WRONG
    setTimeout(() => (isLast ? finishRound(true) : nextCard()), delay)
  }

  function replay() {
    answers.current = []
    lastSeen.current = []
    answered.value = 0
    correct.value = 0
    streak.value = 0
    insights.value = null
    elixirLine.value = pickLine('idle')
    elixirMood.value = 'neutral'
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
          eyebrow="Practice round"
          headline={`${ins.correct} / ${ins.total} · ${ins.accuracyPct}%`}
          elixirLine={elixirLine.value}
          elixirMood={elixirMood.value}
          insights={ins}
          onReplay={replay}
          onHome={() => navigate('/')}
        >
          {strongSession.value && <Recruit />}
        </Summary>
      </div>
    )
  }

  const accuracy = answered.value > 0 ? Math.round((correct.value / answered.value) * 100) : null

  return (
    <div class="main-content" style={{ alignItems: 'center', gap: 24 }}>
      {/* Round progress */}
      <div class="session-bar">
        <div class="session-bar__stat">
          <span class="session-bar__val">
            {Math.min(answered.value + 1, PRACTICE_ROUND_LEN)}
            <span class="session-bar__sep"> / {PRACTICE_ROUND_LEN}</span>
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

      {/* Round progress bar */}
      <div class="progress-track" aria-hidden="true">
        <div class="progress-track__fill" style={{ width: `${(answered.value / PRACTICE_ROUND_LEN) * 100}%` }} />
      </div>

      {/* Card */}
      <CardDisplay card={currentCard.value} phase={phase.value} dropAnimKey={dropKey.value} />

      {/* Question prompt + input toggle */}
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

      {/* Input */}
      {inputStyle.value === 'keypad' ? (
        <PipKeypad onPick={handleAnswer} disabled={phase.value !== 'playing'} />
      ) : (
        <MultipleChoice choices={choices.value} onPick={handleAnswer} disabled={phase.value !== 'playing'} />
      )}

      {/* Elixir host */}
      <ElixirHost line={elixirLine.value} mood={elixirMood.value} />
    </div>
  )
}
