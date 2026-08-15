import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { TRADE_ROUNDS } from '@elixir-drop/contracts'
import type { Card } from '../../types'
import { getRecords } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { formatSeconds } from '../../lib/format'
import { tradeSummaryLine } from '../../lib/mode-insights'
import { computeInsights } from '../../lib/insights'
import { pbCallout } from '../../lib/pb-callout'
import { useAutoStart } from '../../lib/use-auto-start'
import { useGameKeys } from '../../lib/use-game-keys'
import { useGameRuntime } from '../../lib/use-game-runtime'
import { formatTrade, pickTradeHintCard, sideTotal, tradeValue, TRADE_ANSWERS } from '../../lib/trade'
import { CardArt } from '../../components/CardChrome'
import Icon from '../../components/Icon'
import Summary from '../../components/Summary'
import GameRunGate from '../../components/GameRunGate'
import FloatingCue from '../../components/FloatingCue'
import GameMotion from '../../components/GameMotion'
import GameFrame from '../../components/game/GameFrame'
import GameStartScreen from '../../components/game/GameStart'
import { preloadGameFx } from '../../components/GameFxLayer'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'
import { observeInput, runInputEvidence, type InputObservation, type RunInputEvidence } from '../../lib/input-evidence'

// Trade tunables — one config object (SPEC §9). The exchange count is NOT a
// tunable here: it is the length of the shared board ladder the server deals,
// so the two can never disagree about how long a run is.
const TRADE = {
  SEQUENCE_LEN: TRADE_ROUNDS,
  PENALTY_MS: 2000
}

// Keep the same brief correct-answer beat as Surge, then deal automatically.
// Trade is timed, so advancing must never depend on another player action.
const CORRECT_BEAT_MS = 280
const COUNTDOWN_STEP_MS = 700
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
    <section class={`ed-trade__team ed-trade__team--${side}`} data-card-count={cards.length}>
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
  const roundMisses = useRef(0)
  const runStartedAt = useRef(0)
  const inputEnabledAt = useRef(0)
  const currentGuesses = useRef<number[]>([])
  const serverAnswers = useRef<Array<{ guesses: number[]; atMs: number }>>([])
  const inputEvents = useRef<RunInputEvidence[]>([])

  const runtime = useGameRuntime({ countdownStepMs: COUNTDOWN_STEP_MS })
  const { stage, count, elapsedMs, later } = runtime
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

  const rearmAutoStart = useAutoStart(Boolean(gameRun.content) && gameRun.assetsReady, stage, () => void start())

  async function start() {
    if (!(await gameRun.ensureFreshRun())) return
    runtime.start((startedAt) => {
      runStartedAt.current = startedAt
      inputEnabledAt.current = startedAt
      roundMisses.current = 0
      currentGuesses.current = []
      serverAnswers.current = []
      inputEvents.current = []
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
    inputEnabledAt.current = performance.now()
    feedback.value = 'idle'
    hintedOnLastGuess.value = false
    picked.value = null
    revealedIds.value = new Set()
    runtime.emitCue('round-advance', { roundIndex: index.value })
  }

  function finish(finalScore?: number) {
    const total = finalScore ?? runtime.currentElapsed()
    const best = getRecords().tradeLadderBest
    const pb = best === undefined || total < best
    totalMs.value = total
    elapsedMs.value = total
    prevBest.value = best
    isPB.value = pb

    // tradeLadderBest is persisted centrally when the server accepts the run.
    elixirLine.value = tradeSummaryLine({
      isPB: !gameRun.offline && pb,
      totalMs: total,
      sequenceLen: TRADE.SEQUENCE_LEN,
      cleanTrades: cleanTrades.value,
      wrongGuesses: wrongGuesses.value,
      lastTrade: lastTrade.value
    })
    runtime.finish()
    void gameRun.complete({ answers: serverAnswers.current, inputEvents: inputEvents.current })
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }))
  }

  function guess(value: number, observation: InputObservation) {
    if (stage.value !== 'running' || feedback.value !== 'idle') return

    const round = rounds?.[index.value]
    if (!round) return
    inputEvents.current.push(
      runInputEvidence(observation, runStartedAt.current, inputEnabledAt.current, index.value, value)
    )
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
        inputEnabledAt.current = performance.now()
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
    // Briefly reveal the arithmetic, then deal the next exchange automatically.
    revealedIds.value = new Set([...round.blue, ...round.red].map((card) => card.id))
    const advance = () => {
      if (index.value + 1 >= TRADE.SEQUENCE_LEN) {
        const misses = serverAnswers.current.reduce((sum, answer) => sum + answer.guesses.length - 1, 0)
        finish(Math.round(atMs) + misses * TRADE.PENALTY_MS)
        return
      }
      nextRound()
    }
    later(advance, CORRECT_BEAT_MS)
  }

  function replay() {
    track('game.replayed', 'trade')
    runtime.reset('ready')
    rearmAutoStart()
    serverAnswers.current = []
    inputEvents.current = []
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
  useGameKeys((event) => {
    if (stage.value !== 'running' || feedback.value !== 'idle') return
    if (event.key === '0') {
      event.preventDefault()
      guess(0, observeInput(event))
      return
    }
    const slot = Number(event.key)
    if (Number.isInteger(slot) && slot >= 1 && slot <= TRADE_ANSWERS.length) {
      event.preventDefault()
      guess(TRADE_ANSWERS[slot - 1]!, observeInput(event))
    }
  })

  if (!rounds) return <GameRunGate modeName="Trade" session={gameRun} />

  const round = rounds[index.value]!

  if (stage.value === 'summary') {
    const callout = pbCallout(isPB.value, prevBest.value, {
      first: 'First Trade logged',
      improved: (previous) => `New best! −${formatSeconds(previous - totalMs.value)}s`,
      standing: (previous) => `Best: ${formatSeconds(previous)}s`
    })
    const accuracyPct = Math.round((cleanTrades.value / TRADE.SEQUENCE_LEN) * 100)

    return (
      <div class="ed-gamewrap">
        <Summary
          eyebrow="Trade complete"
          headline={`${formatSeconds(totalMs.value)}s`}
          pbCallout={callout}
          insights={computeInsights([])}
          moments={[
            { label: 'Clean', value: `${cleanTrades.value}/${TRADE.SEQUENCE_LEN}` },
            { label: 'Accuracy', value: `${accuracyPct}%`, tone: 'green' },
            { label: 'Time', value: `${formatSeconds(totalMs.value)}s`, tone: 'gold' }
          ]}
          share={{ mode: 'trade', score: `${formatSeconds(totalMs.value)}s` }}
          onReplay={replay}
          replayLabel="Play again"
          onHome={() => navigate('/')}
        >
          <p class="ed-trade__coach">{elixirLine.value}</p>
          <div class="ed-trade__math" aria-label="Trade math">
            <span>Last trade {formatTrade(lastTrade.value)}</span>
            <span>{tradeLine(lastTrade.value)}</span>
          </div>
        </Summary>
      </div>
    )
  }

  if (stage.value === 'ready') return <GameStartScreen modeName="Trade" phase="loading" />

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

        <div class="ed-trade__pad" role="group" aria-label="Choose your elixir trade">
          <div class="ed-trade__pad-col">
            <div class="ed-trade__pad-label ed-trade__pad-label--down">You're down</div>
            <div class="ed-trade__pad-grid">
              {negatives.map((value) => (
                <button
                  key={value}
                  class={answerClass(value, 'ed-trade__ans ed-trade__ans--neg')}
                  onClick={(event) => guess(value, observeInput(event))}
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
              onClick={(event) => guess(0, observeInput(event))}
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
                  onClick={(event) => guess(value, observeInput(event))}
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
