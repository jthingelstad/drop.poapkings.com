import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { TRADE_ROUNDS } from '@elixir-drop/contracts'
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
import Icon from '../../components/Icon'
import {
  balanceWinner,
  EXCHANGE_PROMPT,
  ExchangeBoard,
  ExchangePad,
  exchangeSolvedLine
} from '../../components/game/ExchangeBoard'
import Summary from '../../components/Summary'
import SignaturePanel from '../../components/summary/SignaturePanel'
import { tradeSignature, type Signature } from '../../lib/signatures'
import GameRunGate from '../../components/GameRunGate'
import FloatingCue from '../../components/FloatingCue'
import GameMotion from '../../components/GameMotion'
import GameFrame from '../../components/game/GameFrame'
import GameStartScreen from '../../components/game/GameStart'
import { preloadGameFx } from '../../components/GameFxLayer'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'
import { observeInput, runInputEvidence, type InputObservation, type RunInputEvidence } from '../../lib/input-evidence'
import { costForGameKey } from '../../lib/game-keys'

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
  const signature = useSignal<Signature | null>(null)
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
    // Signature: the time on each exchange, retries marked beneath.
    const roundMs = serverAnswers.current.map((a, i) =>
      Math.max(0, Math.round(a.atMs - (serverAnswers.current[i - 1]?.atMs ?? 0)))
    )
    const retries = serverAnswers.current.map((a) => Math.max(0, a.guesses.length - 1))
    signature.value = tradeSignature(roundMs, retries)
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

  // Desktop keyboard mirrors the two-row pad: 1–4 are Blue (+1…+4), 6–9 are Red
  // (−1…−4), and 0 or 5 is Even — instead of a "1 = −4 … 9 = +4" mental table.
  useGameKeys((event) => {
    if (stage.value !== 'running' || feedback.value !== 'idle') return
    const cost = costForGameKey(event)
    if (event.key === '0' || cost === 5) {
      event.preventDefault()
      guess(0, observeInput(event))
      return
    }
    if (cost !== null && cost >= 1 && cost <= 4) {
      event.preventDefault()
      guess(cost, observeInput(event))
    } else if (cost !== null && cost >= 6 && cost <= 9) {
      event.preventDefault()
      guess(-(cost - 5), observeInput(event))
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
          share={{
            mode: 'trade',
            score: `${formatSeconds(totalMs.value)}s`,
            ...(signature.value ? { series: signature.value.values } : {})
          }}
          onReplay={replay}
          replayLabel="Play again"
          onHome={() => navigate('/')}
        >
          {signature.value && <SignaturePanel {...signature.value} />}
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
  const showCost = (cardId: number) => revealedIds.value.has(cardId)

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
          <div class="ed-trade__board" data-trade-index={index.value + 1}>
            <ExchangeBoard
              red={round.red.map((card) => ({ card, showCost: showCost(card.id), key: card.id }))}
              blue={round.blue.map((card) => ({ card, showCost: showCost(card.id), key: card.id }))}
              balanceLabel={balanceWinner(tradeValue(round))}
              revealed={solved}
            />
          </div>
        </GameMotion>

        <div class="ed-trade__prompt">
          {solved ? (
            <span class="ed-trade__math-line" data-testid="trade-math">
              {exchangeSolvedLine(sideTotal(round.red), sideTotal(round.blue), tradeValue(round))}
            </span>
          ) : (
            EXCHANGE_PROMPT
          )}
        </div>

        <ExchangePad
          answers={TRADE_ANSWERS}
          onPick={guess}
          disabled={counting || feedback.value !== 'idle'}
          stateFor={(value) =>
            picked.value === value
              ? feedback.value === 'wrong'
                ? 'is-wrong'
                : feedback.value === 'correct'
                  ? 'is-correct'
                  : ''
              : ''
          }
        />

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
