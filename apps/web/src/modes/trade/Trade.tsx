import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card } from '../../types'
import { getRecords } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { formatSeconds } from '../../lib/format'
import { tradeSummaryLine } from '../../lib/mode-insights'
import { computeInsights } from '../../lib/insights'
import { useGameRuntime } from '../../lib/use-game-runtime'
import { formatTrade, pickTradeHintCard, sideTotal, tradeValue, TRADE_ANSWERS } from '../../lib/trade'
import { CardArt } from '../../components/CardChrome'
import Icon from '../../components/Icon'
import ShareLine from '../../components/ShareLine'
import Summary from '../../components/Summary'
import GameRunGate from '../../components/GameRunGate'
import FloatingCue from '../../components/FloatingCue'
import GameMotion from '../../components/GameMotion'
import GameFrame from '../../components/game/GameFrame'
import { preloadGameFx } from '../../components/GameFxLayer'
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

function tradeLine(value: number): string {
  if (value > 0) return `You got a ${formatTrade(value)} trade.`
  if (value < 0) return `You took a ${formatTrade(value)} trade.`
  return 'Even trade.'
}

// The mode's lesson is cost recall: each card's cost stays hidden until the
// exchange is solved (or a miss reveals a hint card), then the whole board
// reveals so the player sees the arithmetic confirmed.
function TradeCard({ card, revealed }: { card: Card; revealed: boolean }) {
  return (
    <li class={`ed-trade__card${revealed ? ' ed-trade__card--revealed' : ''}`} data-card-id={card.id}>
      <CardArt
        card={card}
        className="ed-trade__card-art"
        imgClassName="ed-trade__card-img"
        fallbackClassName="ed-trade__card-fallback"
        showCost={revealed}
        costClassName="ed-trade__card-cost"
        showName
        nameClassName="ed-trade__card-name"
      />
    </li>
  )
}

function TradeSide({
  label,
  side,
  cards,
  revealedIds
}: {
  label: string
  side: 'blue' | 'red'
  cards: Card[]
  revealedIds: Set<number>
}) {
  return (
    <section class={`ed-trade__team ed-trade__team--${side}`}>
      <span class="ed-trade__team-label">{label}</span>
      <ol class="ed-trade__cards">
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
  const started = useRef(false)
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
    preloadGameFx()
  }, [])

  // Play → countdown (no manual ready screen). Auto-start once loaded; re-arms on
  // replay. start() is reached via a ref so this only re-fires on load state.
  const startRef = useRef<() => void>(() => {})
  startRef.current = start
  useEffect(() => {
    if (gameRun.content && gameRun.assetsReady && !started.current && stage.peek() === 'ready') {
      started.current = true
      startRef.current()
    }
  }, [gameRun.content, gameRun.assetsReady, stage])

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

    // tradeBest is persisted centrally when the server accepts the run.
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
      // Each miss reveals one more card's cost as a hint toward the arithmetic.
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
    // Reveal the whole exchange — every cost plus both sums — so the player sees
    // the arithmetic confirmed, then advance on tap or after the beat.
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
    track('game.replayed', 'trade')
    runtime.reset('ready')
    started.current = false
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

  // Desktop keyboard: number keys 1-9 map to the answer pad left→right
  // (1 = −4 … 5 = Even … 9 = +4); 0 also answers Even.
  const keyRef = useRef<(event: KeyboardEvent) => void>(() => {})
  keyRef.current = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return
    if (stage.value !== 'running' || feedback.value !== 'idle') return
    if (event.key === '0') {
      event.preventDefault()
      guess(0)
      return
    }
    const slot = Number(event.key)
    if (Number.isInteger(slot) && slot >= 1 && slot <= TRADE_ANSWERS.length) {
      event.preventDefault()
      guess(TRADE_ANSWERS[slot - 1]!)
    }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyRef.current(event)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
    const accuracyPct = Math.round((cleanTrades.value / TRADE.SEQUENCE_LEN) * 100)

    return (
      <div class="ed-gamewrap">
        <Summary
          eyebrow="Trade complete"
          headline={`${formatSeconds(totalMs.value)}s`}
          pbCallout={pbCallout}
          insights={computeInsights([])}
          moments={[
            { label: 'Clean', value: `${cleanTrades.value}/${TRADE.SEQUENCE_LEN}` },
            { label: 'Accuracy', value: `${accuracyPct}%`, tone: 'green' },
            { label: 'Time', value: `${formatSeconds(totalMs.value)}s`, tone: 'gold' }
          ]}
          onReplay={replay}
          replayLabel="Play again"
          onHome={() => navigate('/')}
        >
          <p class="ed-trade__coach">{elixirLine.value}</p>
          <div class="ed-trade__math" aria-label="Trade math">
            <span>Last trade {formatTrade(lastTrade.value)}</span>
            <span>{tradeLine(lastTrade.value)}</span>
          </div>
          <ShareLine
            mode="trade"
            text={`Trade: ${TRADE.SEQUENCE_LEN} exchanges in ${formatSeconds(totalMs.value)}s — drop.poapkings.com`}
          />
        </Summary>
      </div>
    )
  }

  if (stage.value === 'ready') {
    return (
      <div class="ed-gamewrap ed-gameloading" aria-live="polite">
        <span class="ed-drop-shape ed-gameloading__drop" aria-hidden="true" />
        <span>Loading exchange…</span>
      </div>
    )
  }

  const counting = stage.value === 'countdown'
  const solved = feedback.value === 'correct'
  const negatives = TRADE_ANSWERS.filter((v) => v < 0)
  const positives = TRADE_ANSWERS.filter((v) => v > 0)

  function answerClass(value: number, base: string): string {
    const isPicked = picked.value === value
    if (feedback.value === 'wrong' && isPicked) return `${base} ed-trade__ans--wrong`
    if (feedback.value === 'correct' && isPicked) return `${base} ed-trade__ans--correct`
    return base
  }

  return (
    <GameFrame
      modeName="Trade"
      counting={counting}
      count={count.value}
      onQuit={() => navigate('/')}
      cue={runtime.cue.value}
      fxParticles={10}
      progressText={`Round ${Math.min(index.value + 1, TRADE.SEQUENCE_LEN)} / ${TRADE.SEQUENCE_LEN}`}
      metric={{ value: `${formatSeconds(elapsedMs.value)}s`, label: 'time' }}
      progressPct={(index.value / TRADE.SEQUENCE_LEN) * 100}
    >
      <div class="ed-trade">
        <GameMotion contentKey={index.value} cue={runtime.cue.value} preset="board">
          <div class="ed-trade__teams" data-trade-index={index.value + 1}>
            <TradeSide side="blue" label="BLUE — YOU" cards={round.blue} revealedIds={revealedIds.value} />
            <div class="ed-trade__divider" aria-hidden="true">
              <span />
              TRADE
              <span />
            </div>
            <TradeSide side="red" label="RED" cards={round.red} revealedIds={revealedIds.value} />
          </div>
        </GameMotion>

        <div class="ed-trade__prompt">
          {solved ? (
            <span class="ed-trade__math-line" data-testid="trade-math">
              Blue {sideTotal(round.blue)} · Red {sideTotal(round.red)} →{' '}
              <strong>Answer: {formatTrade(tradeValue(round))}</strong>
            </span>
          ) : (
            'Elixir swing from your side?'
          )}
        </div>

        {solved && (
          <div class="ed-trade__next-slot">
            <button class="ed-btn ed-btn--gold ed-btn--sm tap-fx" onClick={() => advanceRef.current()}>
              <span class="tap-face">
                Next trade <Icon name="arrow-right" />
              </span>
            </button>
          </div>
        )}

        <div class="ed-trade__pad" role="group" aria-label="Choose your elixir trade">
          <div class="ed-trade__pad-col">
            <div class="ed-trade__pad-label ed-trade__pad-label--down">You're down</div>
            <div class="ed-trade__pad-grid">
              {negatives.map((value) => (
                <button
                  key={value}
                  class={answerClass(value, 'ed-trade__ans ed-trade__ans--neg')}
                  onClick={() => guess(value)}
                  disabled={counting || feedback.value !== 'idle'}
                  aria-label={`${formatTrade(value)} trade`}
                >
                  {formatTrade(value)}
                </button>
              ))}
            </div>
          </div>
          <div class="ed-trade__pad-mid">
            <div class="ed-trade__pad-label">Wash</div>
            <button
              class={answerClass(0, 'ed-trade__ans ed-trade__ans--even')}
              onClick={() => guess(0)}
              disabled={counting || feedback.value !== 'idle'}
              aria-label="Even trade"
            >
              EVEN
            </button>
          </div>
          <div class="ed-trade__pad-col">
            <div class="ed-trade__pad-label ed-trade__pad-label--up">You're up</div>
            <div class="ed-trade__pad-grid">
              {positives.map((value) => (
                <button
                  key={value}
                  class={answerClass(value, 'ed-trade__ans ed-trade__ans--pos')}
                  onClick={() => guess(value)}
                  disabled={counting || feedback.value !== 'idle'}
                  aria-label={`${formatTrade(value)} trade`}
                >
                  {formatTrade(value)}
                </button>
              ))}
            </div>
          </div>
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
    </GameFrame>
  )
}
