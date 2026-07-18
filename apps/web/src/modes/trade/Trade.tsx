import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card, CardsData } from '../../types'
import rawCards from '@elixir-drop/game-data/cards.json'
import { sampleUnseenCard } from '../../lib/sampling'
import { getRecords, saveRecords } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { formatSeconds } from '../../lib/format'
import { tradeSummaryLine } from '../../lib/mode-insights'
import { preloadImages } from '../../lib/preload'
import { useTimedRun } from '../../lib/use-timed-run'
import {
  formatTrade,
  isTradeInRange,
  pickTradeHintCard,
  tradeValue,
  TRADE_ANSWERS,
  type TradeRound
} from '../../lib/trade'
import { CardArt } from '../../components/CardChrome'
import ElixirHost from '../../components/ElixirHost'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'
import { useGameRun } from '../../lib/use-game-run'
import { challengeCards } from '../../lib/challenge-cards'

const cardsData = rawCards as CardsData
const ALL_CARDS = cardsData.cards

const TRADE = {
  SEQUENCE_LEN: 8,
  PENALTY_MS: 2000,
  MIN_SIDE_CARDS: 1,
  MAX_SIDE_CARDS: 3
}

const CORRECT_BEAT_MS = 240
const COUNTDOWN_STEP_MS = 650
const WRONG_BEAT_MS = 720

type Feedback = 'idle' | 'wrong' | 'correct'

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

function roundCards(round: TradeRound): Card[] {
  return [...round.blue, ...round.red]
}

function pickTradeRound(
  excluded: ReadonlySet<number>,
  recent: readonly number[]
): { round: TradeRound; recent: number[] } {
  for (let tries = 0; tries < 160; tries += 1) {
    const seen = new Set<number>(excluded)
    const nextRecent = [...recent]
    const blue = pickSide(randomInt(TRADE.MIN_SIDE_CARDS, TRADE.MAX_SIDE_CARDS), seen, nextRecent)
    const red = pickSide(randomInt(TRADE.MIN_SIDE_CARDS, TRADE.MAX_SIDE_CARDS), seen, nextRecent)
    const round = { blue, red }
    if (isTradeInRange(tradeValue(round))) return { round, recent: nextRecent }
  }

  const available = ALL_CARDS.filter((card) => !excluded.has(card.id))
  const pool = available.length > 1 ? available : ALL_CARDS
  const blue = [...pool].sort((a, b) => a.elixir - b.elixir)[0]
  const red =
    pool.find((card) => card.id !== blue.id && isTradeInRange(card.elixir - blue.elixir)) ??
    pool.find((card) => card.id !== blue.id) ??
    blue
  return { round: { blue: [blue], red: [red] }, recent: [...recent, blue.id, red.id].slice(-6) }
}

function pickTradeSequence(length: number): TradeRound[] {
  const excluded = new Set<number>()
  let recent: number[] = []
  const sequence: TradeRound[] = []

  while (sequence.length < length) {
    const next = pickTradeRound(excluded, recent)
    sequence.push(next.round)
    recent = next.recent
    for (const card of roundCards(next.round)) excluded.add(card.id)
  }

  return sequence
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
  return (
    <li class={`trade-card${revealed ? ' trade-card--revealed' : ''}`} data-card-id={card.id}>
      <CardArt
        card={card}
        className="trade-card__art"
        imgClassName="trade-card__img"
        fallbackClassName="trade-card__fallback"
        showCost={revealed}
        costClassName="trade-card__cost"
        showName
        nameClassName="trade-card__name"
      />
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
  const gameRun = useGameRun('trade')
  const rounds = useRef<TradeRound[]>(pickTradeSequence(TRADE.SEQUENCE_LEN))
  const roundMisses = useRef(0)
  const runStartedAt = useRef(0)
  const currentGuesses = useRef<number[]>([])
  const serverAnswers = useRef<Array<{ guesses: number[]; atMs: number }>>([])

  const timed = useTimedRun({ countdownStepMs: COUNTDOWN_STEP_MS })
  const { stage, count, elapsedMs, later } = timed
  const imagesReady = useSignal(false)
  const index = useSignal(0)
  const revealedIds = useSignal<Set<number>>(new Set())
  const wrongGuesses = useSignal(0)
  const cleanTrades = useSignal(0)
  const lastTrade = useSignal(0)
  const feedback = useSignal<Feedback>('idle')
  const hintedOnLastGuess = useSignal(false)
  const picked = useSignal<number | null>(null)
  const totalMs = useSignal(0)
  const isPB = useSignal(false)
  const prevBest = useSignal<number | undefined>(undefined)
  const elixirLine = useSignal('')

  useEffect(() => {
    track('mode.trade')
    preloadImages(rounds.current.flatMap(roundCards), () => (imagesReady.value = true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const challenge = gameRun.challenge.value
    if (!challenge || stage.value !== 'ready') return
    const resolved = challenge.rounds.map((round) => ({
      blue: challengeCards(round.blueIds),
      red: challengeCards(round.redIds)
    }))
    if (resolved.some((round) => !round.blue.length || !round.red.length)) return
    rounds.current = resolved
    imagesReady.value = false
    preloadImages(resolved.flatMap(roundCards), () => (imagesReady.value = true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameRun.challenge.value])

  function start() {
    timed.start((startedAt) => {
      runStartedAt.current = startedAt
      roundMisses.current = 0
      currentGuesses.current = []
      serverAnswers.current = []
      index.value = 0
      wrongGuesses.value = 0
      cleanTrades.value = 0
      lastTrade.value = 0
      feedback.value = 'idle'
      hintedOnLastGuess.value = false
      picked.value = null
      revealedIds.value = new Set()
    })
  }

  function nextRound() {
    roundMisses.current = 0
    currentGuesses.current = []
    index.value += 1
    feedback.value = 'idle'
    hintedOnLastGuess.value = false
    picked.value = null
    revealedIds.value = new Set()
  }

  function finish(finalScore?: number) {
    const total = finalScore ?? timed.currentElapsed()
    const best = getRecords().tradeBest
    const pb = best === undefined || total < best
    totalMs.value = total
    elapsedMs.value = total
    prevBest.value = best
    isPB.value = pb

    if (pb) {
      saveRecords({ tradeBest: total })
      track('record.new')
    }
    track('trade.complete')
    elixirLine.value = tradeSummaryLine({
      isPB: pb,
      totalMs: total,
      sequenceLen: TRADE.SEQUENCE_LEN,
      cleanTrades: cleanTrades.value,
      wrongGuesses: wrongGuesses.value,
      lastTrade: lastTrade.value
    })
    timed.setStage('summary')
    void gameRun.complete({ answers: serverAnswers.current })
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }))
  }

  function guess(value: number) {
    if (stage.value !== 'running' || feedback.value !== 'idle') return

    const round = rounds.current[index.value]
    picked.value = value
    currentGuesses.current.push(value)
    const answer = tradeValue(round)
    if (value !== answer) {
      playWrong()
      const hintId = pickTradeHintCard(round, revealedIds.value)
      if (hintId !== undefined) {
        const next = new Set(revealedIds.value)
        next.add(hintId)
        revealedIds.value = next
      }
      hintedOnLastGuess.value = hintId !== undefined
      roundMisses.current += 1
      wrongGuesses.value += 1
      timed.addPenalty(TRADE.PENALTY_MS)
      feedback.value = 'wrong'
      later(() => {
        feedback.value = 'idle'
        hintedOnLastGuess.value = false
        picked.value = null
      }, WRONG_BEAT_MS)
      return
    }

    playCorrect()
    const atMs = performance.now() - runStartedAt.current
    serverAnswers.current.push({ guesses: [...currentGuesses.current], atMs })
    lastTrade.value = answer
    if (roundMisses.current === 0) cleanTrades.value += 1
    feedback.value = 'correct'
    later(() => {
      if (index.value + 1 >= TRADE.SEQUENCE_LEN) {
        const misses = serverAnswers.current.reduce((sum, answer) => sum + answer.guesses.length - 1, 0)
        finish(Math.round(atMs) + misses * TRADE.PENALTY_MS)
        return
      }
      nextRound()
    }, CORRECT_BEAT_MS)
  }

  function replay() {
    timed.reset('ready')
    rounds.current = pickTradeSequence(TRADE.SEQUENCE_LEN)
    serverAnswers.current = []
    currentGuesses.current = []
    imagesReady.value = false
    index.value = 0
    wrongGuesses.value = 0
    cleanTrades.value = 0
    lastTrade.value = 0
    roundMisses.current = 0
    feedback.value = 'idle'
    hintedOnLastGuess.value = false
    picked.value = null
    revealedIds.value = new Set()
    isPB.value = false
    prevBest.value = undefined
    totalMs.value = 0
    preloadImages(rounds.current.flatMap(roundCards), () => (imagesReady.value = true))
    void gameRun.prepare()
  }

  const round = rounds.current[index.value]

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
          <div class="trade-result__value">
            {TRADE.SEQUENCE_LEN} trades · {formatSeconds(totalMs.value)}s
          </div>
          {pbCallout && <div class="summary__pb">{pbCallout}</div>}
          <div class="trade-result__sub">
            {cleanTrades.value} clean · {pluralizeMisses(wrongGuesses.value)}
          </div>

          <ElixirHost line={elixirLine.value} mood={isPB.value ? 'celebrate' : 'gg'} />

          <div class="trade-result__math" aria-label="Trade math">
            <span>Last trade {formatTrade(lastTrade.value)}</span>
            <span>{tradeLine(lastTrade.value)}</span>
          </div>

          <ShareLine
            text={`Trade: ${TRADE.SEQUENCE_LEN} exchanges in ${formatSeconds(totalMs.value)}s — drop.poapkings.com`}
          />
          {isPB.value && <Recruit />}

          <div class="summary__actions">
            <button class="btn btn--gold" onClick={replay}>
              Run Trade again
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
            You are <strong>Blue King</strong>. Solve {TRADE.SEQUENCE_LEN} exchanges. Positive means Red spent more than
            you.
          </p>
          <button
            class="btn btn--gold surge-ready__go"
            onClick={start}
            disabled={!imagesReady.value || gameRun.preparing.value}
          >
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
      <div class="main-content game-run trade">
        <div class="surge-countdown" aria-live="assertive">
          {count.value}
        </div>
        <p class="lede">Count the exchanges…</p>
      </div>
    )
  }

  return (
    <div class="main-content game-run trade" style={{ alignItems: 'center', gap: 18 }}>
      <div class="surge-hud trade-hud">
        <div class="surge-hud__timer" aria-label="elapsed time">
          {formatSeconds(elapsedMs.value)}
          <span class="surge-hud__unit">s</span>
        </div>
        <div class="surge-hud__count">
          trade {index.value + 1} / {TRADE.SEQUENCE_LEN}
        </div>
      </div>

      <div class="progress-track" aria-hidden="true">
        <div class="progress-track__fill" style={{ width: `${(index.value / TRADE.SEQUENCE_LEN) * 100}%` }} />
      </div>

      <div class="trade-board" data-trade-index={index.value + 1}>
        <TradeSide side="blue" label="You played" sub="Blue King" cards={round.blue} revealedIds={revealedIds.value} />
        <div class="trade-versus" aria-hidden="true">
          vs
        </div>
        <TradeSide
          side="red"
          label="Opponent played"
          sub="Red King"
          cards={round.red}
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
          if (feedback.value === 'correct' && isPicked) classes.push('trade-answer--correct')
          return (
            <button
              key={value}
              class={classes.join(' ')}
              onClick={() => guess(value)}
              disabled={feedback.value !== 'idle'}
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
