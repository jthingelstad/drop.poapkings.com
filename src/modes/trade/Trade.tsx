import { useSignal } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Card, CardsData } from '../../types'
import rawCards from '../../data/cards.json'
import { sampleUnseenCard } from '../../lib/sampling'
import { getRecords, saveRecords } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { formatSeconds } from '../../lib/format'
import { preloadImages } from '../../lib/preload'
import {
  formatTrade,
  isTradeInRange,
  pickTradeHintCard,
  sideTotal,
  tradeValue,
  TRADE_ANSWERS,
  type TradeRound
} from '../../lib/trade'
import ElixirHost from '../../components/ElixirHost'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'

const cardsData = rawCards as CardsData
const ALL_CARDS = cardsData.cards

const TRADE = {
  PENALTY_MS: 2000,
  MIN_SIDE_CARDS: 1,
  MAX_SIDE_CARDS: 3
}

const COUNTDOWN_STEP_MS = 650
const WRONG_BEAT_MS = 720

type Stage = 'ready' | 'countdown' | 'running' | 'summary'
type Feedback = 'idle' | 'wrong'

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pickSide(count: number, seen: Set<number>, recent: number[]): Card[] {
  const cards: Card[] = []
  while (cards.length < count) {
    const card = sampleUnseenCard(ALL_CARDS, seen, recent)
    cards.push(card)
    recent.push(card.id)
    if (recent.length > 6) recent.shift()
  }
  return cards
}

function pickTradeRound(): TradeRound {
  for (let tries = 0; tries < 160; tries += 1) {
    const seen = new Set<number>()
    const recent: number[] = []
    const blue = pickSide(randomInt(TRADE.MIN_SIDE_CARDS, TRADE.MAX_SIDE_CARDS), seen, recent)
    const red = pickSide(randomInt(TRADE.MIN_SIDE_CARDS, TRADE.MAX_SIDE_CARDS), seen, recent)
    const round = { blue, red }
    if (isTradeInRange(tradeValue(round))) return round
  }

  const blue = [...ALL_CARDS].sort((a, b) => a.elixir - b.elixir)[0]
  const red =
    ALL_CARDS.find((card) => card.id !== blue.id && isTradeInRange(card.elixir - blue.elixir)) ??
    ALL_CARDS.find((card) => card.id !== blue.id) ??
    blue
  return { blue: [blue], red: [red] }
}

function pluralizeMisses(count: number): string {
  return `${count} ${count === 1 ? 'miss' : 'misses'}`
}

function tradeLine(value: number): string {
  if (value > 0) return `You got a ${formatTrade(value)} trade.`
  if (value < 0) return `You took a ${formatTrade(value)} trade.`
  return 'Even trade.'
}

function TradeCard({ card, revealed }: { card: Card; revealed: boolean }) {
  const [failed, setFailed] = useState(false)
  const showImage = card.icon && !failed

  return (
    <li class={`trade-card${revealed ? ' trade-card--revealed' : ''}`} data-card-id={card.id}>
      <span class="trade-card__art">
        {showImage ? (
          <img class="trade-card__img" src={card.icon} alt="" loading="lazy" onError={() => setFailed(true)} />
        ) : (
          <span class="trade-card__fallback" aria-hidden="true" />
        )}
        {revealed && (
          <span class="trade-card__cost" aria-label={`${card.elixir} elixir`}>
            <img src="/assets/elixir-drop.png" alt="" class="elixir-pip" />
            {card.elixir}
          </span>
        )}
        <span class="trade-card__name">{card.name}</span>
      </span>
    </li>
  )
}

function TradeSide({
  label,
  sub,
  side,
  cards,
  revealedIds
}: {
  label: string
  sub: string
  side: 'blue' | 'red'
  cards: Card[]
  revealedIds: Set<number>
}) {
  return (
    <section class={`trade-side trade-side--${side}`}>
      <div class="trade-side__head">
        <span class="trade-side__badge">{side === 'blue' ? 'Blue King' : 'Red King'}</span>
        <div>
          <h2 class="trade-side__title">{label}</h2>
          <p class="trade-side__sub">{sub}</p>
        </div>
      </div>
      <ol class="trade-side__cards">
        {cards.map((card) => (
          <TradeCard key={card.id} card={card} revealed={revealedIds.has(card.id)} />
        ))}
      </ol>
    </section>
  )
}

export default function Trade() {
  const timers = useRef<number[]>([])
  const startTime = useRef(0)
  const penaltyMs = useRef(0)

  const stage = useSignal<Stage>('ready')
  const imagesReady = useSignal(false)
  const count = useSignal(3)
  const round = useSignal<TradeRound>(pickTradeRound())
  const revealedIds = useSignal<Set<number>>(new Set())
  const elapsedMs = useSignal(0)
  const wrongGuesses = useSignal(0)
  const feedback = useSignal<Feedback>('idle')
  const hintedOnLastGuess = useSignal(false)
  const picked = useSignal<number | null>(null)
  const totalMs = useSignal(0)
  const isPB = useSignal(false)
  const prevBest = useSignal<number | undefined>(undefined)
  const elixirLine = useSignal('')

  useEffect(() => {
    track('mode.trade')
    preloadImages([...round.value.blue, ...round.value.red], () => (imagesReady.value = true))
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
    elapsedMs.value = 0
    wrongGuesses.value = 0
    feedback.value = 'idle'
    hintedOnLastGuess.value = false
    picked.value = null
    revealedIds.value = new Set()
    stage.value = 'running'
  }

  function guess(value: number) {
    if (stage.value !== 'running' || feedback.value === 'wrong') return

    picked.value = value
    const answer = tradeValue(round.value)
    if (value !== answer) {
      playWrong()
      const hintId = pickTradeHintCard(round.value, revealedIds.value)
      if (hintId !== undefined) {
        const next = new Set(revealedIds.value)
        next.add(hintId)
        revealedIds.value = next
      }
      hintedOnLastGuess.value = hintId !== undefined
      wrongGuesses.value += 1
      penaltyMs.current += TRADE.PENALTY_MS
      feedback.value = 'wrong'
      later(() => {
        feedback.value = 'idle'
        hintedOnLastGuess.value = false
        picked.value = null
      }, WRONG_BEAT_MS)
      return
    }

    playCorrect()
    const total = performance.now() - startTime.current + penaltyMs.current
    const best = getRecords().tradeBest
    const pb = best === undefined || total < best
    totalMs.value = total
    prevBest.value = best
    isPB.value = pb

    if (pb) {
      saveRecords({ tradeBest: total })
      track('record.new')
    }
    track('trade.complete')
    elixirLine.value = pb
      ? `New Trade best: ${formatSeconds(total)}s. That's real elixir math.`
      : `${formatSeconds(total)}s. ${tradeLine(answer)}`
    stage.value = 'summary'
  }

  function replay() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    const next = pickTradeRound()
    round.value = next
    imagesReady.value = false
    count.value = 3
    elapsedMs.value = 0
    wrongGuesses.value = 0
    penaltyMs.current = 0
    feedback.value = 'idle'
    hintedOnLastGuess.value = false
    picked.value = null
    revealedIds.value = new Set()
    isPB.value = false
    prevBest.value = undefined
    totalMs.value = 0
    stage.value = 'ready'
    preloadImages([...next.blue, ...next.red], () => (imagesReady.value = true))
  }

  const answer = tradeValue(round.value)

  if (stage.value === 'summary') {
    const pbCallout = isPB.value
      ? prevBest.value !== undefined
        ? `New best! −${formatSeconds(prevBest.value - totalMs.value)}s`
        : 'First Trade logged'
      : prevBest.value !== undefined
        ? `Best: ${formatSeconds(prevBest.value)}s`
        : undefined

    return (
      <div class="main-content trade">
        <div class="trade-result">
          <div class="eyebrow">Trade complete</div>
          <div class="trade-result__value">{formatTrade(answer)}</div>
          {pbCallout && <div class="summary__pb">{pbCallout}</div>}
          <div class="trade-result__sub">
            {tradeLine(answer)} · {pluralizeMisses(wrongGuesses.value)}
          </div>

          <ElixirHost line={elixirLine.value} mood={isPB.value ? 'celebrate' : 'gg'} />

          <div class="trade-result__math" aria-label="Trade math">
            <span>You spent {sideTotal(round.value.blue)}</span>
            <span>Opponent spent {sideTotal(round.value.red)}</span>
          </div>

          <ShareLine text={`Trade: ${formatTrade(answer)} in ${formatSeconds(totalMs.value)}s — drop.poapkings.com`} />
          {isPB.value && <Recruit />}

          <div class="summary__actions">
            <button class="btn btn--gold" onClick={replay}>
              New trade
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
      <div class="main-content trade">
        <div class="surge-ready trade-ready">
          <div class="eyebrow">Trade · Blue perspective</div>
          <h1 class="h1">Read the elixir trade.</h1>
          <p class="lede">
            You are <strong>Blue King</strong>. Red is the opponent. Positive means Red spent more than you.
          </p>
          <button class="btn btn--gold surge-ready__go" onClick={start} disabled={!imagesReady.value}>
            {imagesReady.value ? 'Start Trade' : 'Loading exchange…'}
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
      <div class="main-content trade">
        <div class="surge-countdown" aria-live="assertive">
          {count.value}
        </div>
        <p class="lede">Count the exchange…</p>
      </div>
    )
  }

  return (
    <div class="main-content trade" style={{ alignItems: 'center', gap: 18 }}>
      <div class="surge-hud trade-hud">
        <div class="surge-hud__timer" aria-label="elapsed time">
          {formatSeconds(elapsedMs.value)}
          <span class="surge-hud__unit">s</span>
        </div>
        <div class="surge-hud__count">
          {wrongGuesses.value ? `+${wrongGuesses.value} ${wrongGuesses.value === 1 ? 'hint' : 'hints'}` : 'your trade'}
        </div>
      </div>

      <div class="trade-board">
        <TradeSide
          side="blue"
          label="You played"
          sub="Blue King"
          cards={round.value.blue}
          revealedIds={revealedIds.value}
        />
        <div class="trade-versus" aria-hidden="true">
          vs
        </div>
        <TradeSide
          side="red"
          label="Opponent played"
          sub="Red King"
          cards={round.value.red}
          revealedIds={revealedIds.value}
        />
      </div>

      <div class="trade-prompt">
        <span>What was your elixir trade?</span>
        <strong>
          {feedback.value === 'wrong'
            ? `${hintedOnLastGuess.value ? 'Cost revealed' : 'Try again'}. +${TRADE.PENALTY_MS / 1000}s`
            : 'Blue perspective'}
        </strong>
      </div>

      <div class="trade-answers" role="group" aria-label="Choose your elixir trade">
        {TRADE_ANSWERS.map((value) => {
          const isPicked = picked.value === value
          const classes = ['trade-answer']
          if (feedback.value === 'wrong' && isPicked) classes.push('trade-answer--wrong')
          return (
            <button
              key={value}
              class={classes.join(' ')}
              onClick={() => guess(value)}
              disabled={feedback.value === 'wrong'}
              aria-label={value === 0 ? 'Even trade' : `${formatTrade(value)} trade`}
            >
              {formatTrade(value)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
