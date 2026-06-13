import { useSignal } from '@preact/signals'
import { useRef } from 'preact/hooks'
import type { Card, ElixirMood, InputStyle } from '../../types'
import type { CardsData } from '../../types'
import rawCards from '../../data/cards.json'
import { sampleCard } from '../../lib/sampling'
import { makeChoices } from '../../lib/choices'
import { saveResult, getSettings, saveSettings } from '../../lib/storage'
import { pickLine } from '../../lib/elixir-lines'
import CardDisplay from '../../components/CardDisplay'
import PipKeypad from '../../components/PipKeypad'
import MultipleChoice from '../../components/MultipleChoice'
import ElixirHost from '../../components/ElixirHost'

const cardsData = rawCards as CardsData
const ALL_CARDS = cardsData.cards

const ADVANCE_DELAY_CORRECT = 1300
const ADVANCE_DELAY_WRONG   = 1600

export default function Practice() {
  const lastSeen = useRef<number[]>([])

  const settings   = getSettings()
  const inputStyle = useSignal<InputStyle>(settings.inputStyle)
  const currentCard = useSignal<Card>(sampleCard(ALL_CARDS, lastSeen.current))
  const choices    = useSignal<number[]>(makeChoices(currentCard.value.elixir))
  const phase      = useSignal<'playing' | 'correct' | 'wrong'>('playing')
  const elixirLine = useSignal<string>(pickLine('idle'))
  const elixirMood = useSignal<ElixirMood>('neutral')
  const dropKey    = useSignal(0)
  const streak     = useSignal(0)
  const answered   = useSignal(0)
  const correct    = useSignal(0)

  function advanceCard() {
    const next = sampleCard(ALL_CARDS, lastSeen.current)

    // Keep lastSeen as a window of recent card ids
    lastSeen.current = [...lastSeen.current.slice(-5), next.id]

    currentCard.value = next
    choices.value = makeChoices(next.elixir)
    phase.value = 'playing'
    elixirLine.value = ''
    elixirMood.value = 'neutral'
  }

  function handleAnswer(picked: number) {
    if (phase.value !== 'playing') return

    const card = currentCard.value
    const isCorrect = picked === card.elixir

    saveResult(card.id, isCorrect)
    answered.value++

    if (isCorrect) {
      correct.value++
      streak.value++
      dropKey.value++
      phase.value = 'correct'

      const event = streak.value >= 3 ? 'correct_streak' : 'correct_fast'
      elixirLine.value = pickLine(event, { n: streak.value })
      elixirMood.value = 'hype'

      setTimeout(advanceCard, ADVANCE_DELAY_CORRECT)
    } else {
      streak.value = 0
      phase.value = 'wrong'

      const diff = Math.abs(picked - card.elixir)
      elixirLine.value = pickLine(diff <= 1 ? 'wrong_close' : 'wrong_far')
      elixirMood.value = 'unimpressed'

      setTimeout(advanceCard, ADVANCE_DELAY_WRONG)
    }
  }

  function switchInput(style: InputStyle) {
    inputStyle.value = style
    saveSettings({ inputStyle: style })
  }

  const accuracy = answered.value > 0
    ? Math.round((correct.value / answered.value) * 100)
    : null

  return (
    <div class="main-content" style={{ alignItems: 'center', gap: 24 }}>
      {/* Session stats */}
      <div class="session-bar">
        <div class="session-bar__stat">
          <span class="session-bar__val">{answered.value}</span>
          <span>answered</span>
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
      </div>

      {/* Card */}
      <CardDisplay
        card={currentCard.value}
        phase={phase.value}
        dropAnimKey={dropKey.value}
      />

      {/* Question prompt */}
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
        <MultipleChoice
          choices={choices.value}
          onPick={handleAnswer}
          disabled={phase.value !== 'playing'}
        />
      )}

      {/* Elixir host */}
      <ElixirHost line={elixirLine.value} mood={elixirMood.value} />
    </div>
  )
}
