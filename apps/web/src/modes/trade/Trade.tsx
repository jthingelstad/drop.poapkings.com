import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card } from '../../types'
import { getRecords, saveRecords } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { formatSeconds } from '../../lib/format'
import { tradeSummaryLine } from '../../lib/mode-insights'
import { useGameRuntime } from '../../lib/use-game-runtime'
import { formatTrade, pickTradeHintCard, sideTotal, tradeValue, TRADE_ANSWERS } from '../../lib/trade'
import { CardArt } from '../../components/CardChrome'
import Icon from '../../components/Icon'
import ElixirHost from '../../components/ElixirHost'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'
import GameRunGate from '../../components/GameRunGate'
import FloatingCue from '../../components/FloatingCue'
import GameMotion from '../../components/GameMotion'
import GameFxLayer, { preloadGameFx } from '../../components/GameFxLayer'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'

const TRADE = {
  SEQUENCE_LEN: 8,
  PENALTY_MS: 2000
}

// A solved exchange reveals every cost and both sums — the mode's actual
// lesson. Speed players tap straight through; the clock only charges the
// dwell a player chooses to spend reading.
const REVEAL_BEAT_MS = 1600
const COUNTDOWN_STEP_MS = 650
const WRONG_BEAT_MS = 720

type Feedback = 'idle' | 'wrong' | 'correct'

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
  const gameRun = useGameSession('trade', challengePreparers.trade)
  const rounds = gameRun.content
  const roundMisses = useRef(0)
  const runStartedAt = useRef(0)
  const currentGuesses = useRef<number[]>([])
  const serverAnswers = useRef<Array<{ guesses: number[]; atMs: number }>>([])

  const runtime = useGameRuntime({ countdownStepMs: COUNTDOWN_STEP_MS })
  const { stage, count, elapsedMs, later } = runtime
  const advanceRef = useRef<() => void>(() => {})
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
    preloadGameFx()
  }, [])

  async function start() {
    if (!(await gameRun.ensureFreshRun())) return
    runtime.start((startedAt) => {
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
    runtime.emitCue('round-advance', { roundIndex: index.value })
  }

  function finish(finalScore?: number) {
    const total = finalScore ?? runtime.currentElapsed()
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
    runtime.finish()
    void gameRun.complete({ answers: serverAnswers.current })
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }))
  }

  function guess(value: number) {
    if (stage.value !== 'running' || feedback.value !== 'idle') return

    const round = rounds?.[index.value]
    if (!round) return
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
      runtime.addPenalty(TRADE.PENALTY_MS)
      feedback.value = 'wrong'
      runtime.emitCue('answer-wrong', { roundIndex: index.value })
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
    runtime.emitCue('answer-correct', { roundIndex: index.value })
    // Reveal the whole exchange — every cost plus both sums — so the player
    // sees the arithmetic confirmed, then advance on tap or after the beat.
    revealedIds.value = new Set([...round.blue, ...round.red].map((card) => card.id))
    let advanced = false
    const advance = () => {
      if (advanced) return
      advanced = true
      if (index.value + 1 >= TRADE.SEQUENCE_LEN) {
        const misses = serverAnswers.current.reduce((sum, answer) => sum + answer.guesses.length - 1, 0)
        finish(Math.round(atMs) + misses * TRADE.PENALTY_MS)
        return
      }
      nextRound()
    }
    advanceRef.current = advance
    later(advance, REVEAL_BEAT_MS)
  }

  function replay() {
    runtime.reset('ready')
    serverAnswers.current = []
    currentGuesses.current = []
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
    void gameRun.prepare()
  }

  if (!rounds) {
    return (
      <GameRunGate preparing={gameRun.preparing.value} error={gameRun.error} onRetry={() => void gameRun.prepare()} />
    )
  }

  const round = rounds[index.value]!

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
            disabled={!gameRun.assetsReady || gameRun.preparing.value}
          >
            {gameRun.assetsReady ? 'Start Trade' : 'Loading exchange…'}
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
      <GameFxLayer cue={runtime.cue.value} particleCount={10} />
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

      <GameMotion contentKey={index.value} cue={runtime.cue.value} preset="board">
        <div class="trade-board" data-trade-index={index.value + 1}>
          <TradeSide
            side="blue"
            label="You played"
            sub="Blue King"
            cards={round.blue}
            revealedIds={revealedIds.value}
          />
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
      </GameMotion>

      {/* Fixed-height prompt: swapping the question for the solved math never
          reflows the board. Transient +2s / retry feedback floats (below). */}
      <div class="trade-prompt">
        {feedback.value === 'correct' ? (
          <span class="trade-prompt__math" data-testid="trade-math">
            Blue {sideTotal(round.blue)} · Red {sideTotal(round.red)} →{' '}
            <strong>{formatTrade(tradeValue(round))}</strong>
          </span>
        ) : (
          <>
            <span>What was your elixir trade?</span>
            <span class="trade-prompt__sub">Blue perspective</span>
          </>
        )}
      </div>

      {/* Reserved row so the Next button never pushes the answer grid. */}
      <div class="trade-next-slot">
        {feedback.value === 'correct' && (
          <button class="btn btn--gold btn--sm trade-next" onClick={() => advanceRef.current()}>
            Next trade <Icon name="arrow-right" />
          </button>
        )}
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

      {/* Transient feedback, composited over the game — never in layout flow. */}
      <div class="game-cues" aria-hidden="true">
        <div class="game-cues__slot game-cues__slot--top">
          <FloatingCue trigger={runtime.penaltyPulse.value} className="floating-cue--penalty">
            <Icon name="timer" /> +2s
          </FloatingCue>
          <FloatingCue trigger={runtime.penaltyPulse.value} className="floating-cue--hint" testId="trade-hint">
            {hintedOnLastGuess.value ? 'Cost revealed' : 'Try again'}
          </FloatingCue>
        </div>
      </div>
    </div>
  )
}
