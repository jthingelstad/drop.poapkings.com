import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card, CardsData } from '../../types'
import rawCards from '../../data/cards.json'
import { sampleUnseenCard } from '../../lib/sampling'
import { getRecords, saveRecords } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { formatSeconds } from '../../lib/format'
import { preloadImages } from '../../lib/preload'
import { makeNameChoices, NAME_CHOICE_COUNT } from '../../lib/name-choices'
import CardDisplay from '../../components/CardDisplay'
import ElixirHost from '../../components/ElixirHost'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'

const cardsData = rawCards as CardsData
const ALL_CARDS = cardsData.cards

const IDENTIFY = {
  SPRINT_LEN: 15,
  PENALTY_MS: 2000,
  CHOICE_COUNT: NAME_CHOICE_COUNT
}

const CORRECT_BEAT_MS = 280
const WRONG_BEAT_MS = 430
const COUNTDOWN_STEP_MS = 650

type Stage = 'ready' | 'countdown' | 'running' | 'summary'
type Phase = 'playing' | 'correct' | 'wrong'

interface IdentifyAnswer {
  card: Card
  firstTry: boolean
  misses: number
  ms: number
}

function pickSprint(n: number): Card[] {
  const chosen: Card[] = []
  const seen = new Set<number>()
  const recent: number[] = []
  while (chosen.length < n) {
    const card = sampleUnseenCard(ALL_CARDS, seen, recent)
    chosen.push(card)
    recent.push(card.id)
    if (recent.length > 6) recent.shift()
  }
  return chosen
}

function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export default function Identify() {
  const sprint = useRef<Card[]>(pickSprint(IDENTIFY.SPRINT_LEN))
  const answers = useRef<IdentifyAnswer[]>([])
  const startTime = useRef(0)
  const cardStart = useRef(0)
  const penaltyMs = useRef(0)
  const timers = useRef<number[]>([])

  const stage = useSignal<Stage>('ready')
  const imagesReady = useSignal(false)
  const count = useSignal(3)
  const index = useSignal(0)
  const choices = useSignal<Card[]>(makeNameChoices(sprint.current[0], ALL_CARDS, IDENTIFY.CHOICE_COUNT))
  const wrongIds = useSignal<Set<number>>(new Set())
  const selectedId = useSignal<number | null>(null)
  const phase = useSignal<Phase>('playing')
  const elapsedMs = useSignal(0)
  const dropKey = useSignal(0)

  const totalMs = useSignal(0)
  const isPB = useSignal(false)
  const prevBest = useSignal<number | undefined>(undefined)
  const firstTryCount = useSignal(0)
  const missCount = useSignal(0)
  const missedCards = useSignal<Card[]>([])
  const elixirLine = useSignal('')

  useEffect(() => {
    track('mode.identify')
    preloadImages(sprint.current, () => (imagesReady.value = true))
    return () => timers.current.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (stage.value !== 'running') return
    let raf = 0
    const loop = () => {
      elapsedMs.value = performance.now() - startTime.current + penaltyMs.current
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.value])

  function later(fn: () => void, ms: number) {
    const id = window.setTimeout(fn, ms)
    timers.current.push(id)
  }

  function setCard(nextIndex: number) {
    index.value = nextIndex
    choices.value = makeNameChoices(sprint.current[nextIndex], ALL_CARDS, IDENTIFY.CHOICE_COUNT)
    wrongIds.value = new Set()
    selectedId.value = null
    cardStart.current = performance.now()
    phase.value = 'playing'
  }

  function start() {
    stage.value = 'countdown'
    count.value = 3
    const step = () => {
      if (count.value <= 1) {
        begin()
        return
      }
      count.value -= 1
      later(step, COUNTDOWN_STEP_MS)
    }
    later(step, COUNTDOWN_STEP_MS)
  }

  function begin() {
    startTime.current = performance.now()
    penaltyMs.current = 0
    answers.current = []
    elapsedMs.value = 0
    setCard(0)
    stage.value = 'running'
  }

  function showNext() {
    const nextIndex = index.value + 1
    if (nextIndex >= IDENTIFY.SPRINT_LEN) {
      finish()
      return
    }
    setCard(nextIndex)
  }

  function finish() {
    const total = performance.now() - startTime.current + penaltyMs.current
    const best = getRecords().identifyBest
    const pb = best === undefined || total < best
    const firstTry = answers.current.filter((answer) => answer.firstTry).length
    const misses = answers.current.reduce((sum, answer) => sum + answer.misses, 0)
    const missed = answers.current.filter((answer) => !answer.firstTry).map((answer) => answer.card)

    totalMs.value = total
    elapsedMs.value = total
    prevBest.value = best
    isPB.value = pb
    firstTryCount.value = firstTry
    missCount.value = misses
    missedCards.value = missed

    if (pb) {
      saveRecords({ identifyBest: total })
      track('record.new')
    }
    track('identify.complete')

    elixirLine.value = pb
      ? `New Identify best: ${formatSeconds(total)}s. Sharp card read.`
      : `${firstTry}/${IDENTIFY.SPRINT_LEN} first try. ${pluralize(misses, 'miss', 'misses')}.`
    stage.value = 'summary'
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }))
  }

  function answer(choice: Card) {
    if (stage.value !== 'running' || phase.value !== 'playing' || wrongIds.value.has(choice.id)) return

    const card = sprint.current[index.value]
    selectedId.value = choice.id

    if (choice.id !== card.id) {
      playWrong()
      penaltyMs.current += IDENTIFY.PENALTY_MS
      const nextWrong = new Set(wrongIds.value)
      nextWrong.add(choice.id)
      wrongIds.value = nextWrong
      phase.value = 'wrong'
      later(() => {
        selectedId.value = null
        phase.value = 'playing'
      }, WRONG_BEAT_MS)
      return
    }

    playCorrect()
    const ms = performance.now() - cardStart.current
    answers.current.push({ card, firstTry: wrongIds.value.size === 0, misses: wrongIds.value.size, ms })
    phase.value = 'correct'
    dropKey.value += 1
    later(showNext, CORRECT_BEAT_MS)
  }

  function replay() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    sprint.current = pickSprint(IDENTIFY.SPRINT_LEN)
    answers.current = []
    penaltyMs.current = 0
    imagesReady.value = false
    count.value = 3
    index.value = 0
    choices.value = makeNameChoices(sprint.current[0], ALL_CARDS, IDENTIFY.CHOICE_COUNT)
    wrongIds.value = new Set()
    selectedId.value = null
    phase.value = 'playing'
    elapsedMs.value = 0
    totalMs.value = 0
    isPB.value = false
    prevBest.value = undefined
    firstTryCount.value = 0
    missCount.value = 0
    missedCards.value = []
    stage.value = 'ready'
    preloadImages(sprint.current, () => (imagesReady.value = true))
  }

  if (stage.value === 'summary') {
    const pbCallout = isPB.value
      ? prevBest.value !== undefined
        ? `New best! -${formatSeconds(prevBest.value - totalMs.value)}s`
        : 'First Identify logged'
      : prevBest.value !== undefined
        ? `Best: ${formatSeconds(prevBest.value)}s`
        : undefined

    return (
      <div class="main-content identify">
        <div class="identify-result">
          <div class="eyebrow">Identify complete</div>
          <div class="identify-result__value">
            {IDENTIFY.SPRINT_LEN} cards · {formatSeconds(totalMs.value)}s
          </div>
          {pbCallout && <div class="summary__pb">{pbCallout}</div>}
          <div class="identify-result__sub">
            {firstTryCount.value} first try · {pluralize(missCount.value, 'miss', 'misses')}
          </div>

          <ElixirHost line={elixirLine.value} mood={isPB.value ? 'celebrate' : 'gg'} />

          {missedCards.value.length > 0 && (
            <div class="identify-result__misses">
              <div class="summary__label">Missed this run</div>
              <div class="summary__chips">
                {missedCards.value.slice(0, 5).map((card) => (
                  <span class="summary-chip" key={card.id}>
                    <span class="summary-chip__name">{card.name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <ShareLine
            text={`Identify: ${firstTryCount.value}/${IDENTIFY.SPRINT_LEN} first try in ${formatSeconds(totalMs.value)}s — drop.poapkings.com`}
          />
          {isPB.value && <Recruit />}

          <div class="summary__actions">
            <button class="btn btn--gold" onClick={replay}>
              Identify again
            </button>
            <button class="btn btn--ghost" onClick={() => navigate('/')}>
              Home
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (stage.value === 'ready') {
    return (
      <div class="main-content identify">
        <div class="surge-ready identify-ready">
          <div class="eyebrow">Identify · Card names</div>
          <h1 class="h1">Name the card.</h1>
          <p class="lede">
            Pick the card's name from six choices. Wrong picks add{' '}
            <strong>+{(IDENTIFY.PENALTY_MS / 1000).toFixed(0)}s</strong> and get eliminated.
          </p>
          <button class="btn btn--gold surge-ready__go" onClick={start} disabled={!imagesReady.value}>
            {imagesReady.value ? 'Start Identify' : 'Loading cards…'}
          </button>
          <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
            Back
          </button>
        </div>
      </div>
    )
  }

  if (stage.value === 'countdown') {
    return (
      <div class="main-content game-run identify">
        <div class="surge-countdown" aria-live="assertive">
          {count.value}
        </div>
        <p class="lede">Read the art…</p>
      </div>
    )
  }

  const card = sprint.current[index.value]

  return (
    <div class="main-content game-run identify identify-run" style={{ alignItems: 'center', gap: 20 }}>
      <div class="surge-hud identify-hud">
        <div class="surge-hud__timer" aria-label="elapsed time">
          {formatSeconds(elapsedMs.value)}
          <span class="surge-hud__unit">s</span>
        </div>
        <div class="surge-hud__count">
          card {index.value + 1} / {IDENTIFY.SPRINT_LEN}
        </div>
      </div>

      <div class="progress-track" aria-hidden="true">
        <div class="progress-track__fill" style={{ width: `${(index.value / IDENTIFY.SPRINT_LEN) * 100}%` }} />
      </div>

      <div class="identify-card" data-testid="identify-card" data-card-id={card.id}>
        <CardDisplay
          card={card}
          phase={phase.value}
          dropAnimKey={dropKey.value}
          revealCost={false}
          hideName
          showMeta={false}
        />
      </div>

      <div class="identify-prompt">
        <span>Which card is this?</span>
        <strong>{phase.value === 'wrong' ? `Not that one. +${IDENTIFY.PENALTY_MS / 1000}s` : 'six choices'}</strong>
      </div>

      <div class="identify-choices" role="group" aria-label="Choose the card name">
        {choices.value.map((choice) => {
          const eliminated = wrongIds.value.has(choice.id)
          const selected = selectedId.value === choice.id
          const correct = phase.value === 'correct' && choice.id === card.id
          const classes = ['identify-choice']
          if (selected && phase.value === 'wrong') classes.push('identify-choice--wrong')
          if (eliminated) classes.push('identify-choice--eliminated')
          if (correct) classes.push('identify-choice--correct')

          return (
            <button
              key={choice.id}
              class={classes.join(' ')}
              disabled={phase.value !== 'playing' || eliminated}
              onClick={() => answer(choice)}
            >
              {choice.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
