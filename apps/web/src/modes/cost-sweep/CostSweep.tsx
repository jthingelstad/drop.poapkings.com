import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card, CardsData } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import rawCards from '@elixir-drop/game-data/cards.json'
import { sampleUnseenCard } from '../../lib/sampling'
import { getRecords, saveRecords, saveResult } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { preloadImages } from '../../lib/preload'
import { computeInsights } from '../../lib/insights'
import { isSweepComplete, remainingTargetIds } from '../../lib/cost-sweep'
import { useTimedRun } from '../../lib/use-timed-run'
import { CardArt } from '../../components/CardChrome'
import Summary from '../../components/Summary'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'
import GameRunGate from '../../components/GameRunGate'
import { useGameRun } from '../../lib/use-game-run'
import { challengeCards } from '../../lib/challenge-cards'

const cardsData = rawCards as CardsData
const ALL_CARDS = cardsData.cards

const SWEEP = {
  BOARD_SIZE: 12,
  WINDOW_MS: 45000,
  WRONG_PENALTY_MS: 2000,
  BOARD_CLEAR_BEAT_MS: 360,
  WRONG_BEAT_MS: 900
}

const COUNTDOWN_STEP_MS = 650

interface SweepBoard {
  cards: Card[]
  targetElixir: number
}

function shuffle(cards: Card[]): Card[] {
  const next = [...cards]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
  }
  return next
}

function eligibleTargetCosts(): number[] {
  const counts = new Map<number, number>()
  for (const card of ALL_CARDS) counts.set(card.elixir, (counts.get(card.elixir) ?? 0) + 1)
  return [...counts.entries()].filter(([, count]) => count >= 2).map(([elixir]) => elixir)
}

const TARGET_COSTS = eligibleTargetCosts()

function SweepCard({
  card,
  isTarget,
  isFound,
  isWrong,
  disabled,
  onPick
}: {
  card: Card
  isTarget: boolean
  isFound: boolean
  isWrong: boolean
  disabled: boolean
  onPick: (card: Card) => void
}) {
  const revealCost = isFound || isWrong

  return (
    <button
      type="button"
      class={`sweep-card${isFound ? ' sweep-card--found' : ''}${isWrong ? ' sweep-card--wrong' : ''}`}
      onClick={() => onPick(card)}
      disabled={disabled || isFound}
      data-card-id={card.id}
      data-elixir={card.elixir}
      data-target={isTarget ? 'true' : 'false'}
    >
      <CardArt
        card={card}
        className="sweep-card__art"
        imgClassName="sweep-card__img"
        fallbackClassName="sweep-card__fallback"
        showCost={revealCost}
        costClassName={`sweep-card__cost${isWrong ? ' sweep-card__cost--wrong' : ''}`}
        costTone={isWrong ? 'wrong' : 'default'}
        showName
        nameClassName="sweep-card__name"
      />
    </button>
  )
}

export default function CostSweep() {
  const gameRun = useGameRun('cost-sweep')
  const recent = useRef<number[]>([])
  const seen = useRef<Set<number>>(new Set())
  const answers = useRef<Answer[]>([])
  const finished = useRef(false)
  const runStartedAt = useRef(0)
  const serverBoards = useRef<SweepBoard[]>([])
  const serverBoardIndex = useRef(0)
  const serverPicks = useRef<Array<{ boardIndex: number; cardId: number; atMs: number }>>([])

  const timed = useTimedRun({
    countdownStepMs: COUNTDOWN_STEP_MS,
    durationMs: SWEEP.WINDOW_MS,
    onDurationEnd: finish
  })
  const { stage, count, elapsedMs: remainingMs, later } = timed
  const imagesReady = useSignal(false)
  const board = useSignal<SweepBoard | null>(null)
  const selectedIds = useSignal<Set<number>>(new Set())
  const wrongIds = useSignal<Set<number>>(new Set())
  const found = useSignal(0)
  const boardsCleared = useSignal(0)
  const wrongTaps = useSignal(0)
  const boardLocked = useSignal(false)
  const insights = useSignal<Insights | null>(null)
  const isPB = useSignal(false)
  const prevBest = useSignal<number | undefined>(undefined)
  const elixirLine = useSignal('')

  useEffect(() => {
    track('mode.costsweep')
    dealRun()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const challenge = gameRun.challenge.value
    if (!challenge || stage.value !== 'ready') return
    const resolved = challenge.boards.map((item) => ({
      targetElixir: item.targetElixir,
      cards: challengeCards(item.cardIds)
    }))
    if (!resolved.length || resolved.some((item) => item.cards.length !== SWEEP.BOARD_SIZE)) return
    serverBoards.current = resolved
    serverBoardIndex.current = 0
    board.value = resolved[0]!
    imagesReady.value = false
    preloadImages(resolved[0]!.cards, () => (imagesReady.value = true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameRun.challenge.value])

  function drawFrom(pool: Card[], usedIds: Set<number>): Card {
    const card = sampleUnseenCard(pool, seen.current, recent.current, [...usedIds])
    usedIds.add(card.id)
    recent.current.push(card.id)
    if (recent.current.length > 10) recent.current.shift()
    return card
  }

  function makeBoard(): SweepBoard {
    const targetElixir = TARGET_COSTS[Math.floor(Math.random() * TARGET_COSTS.length)] ?? 4
    const targetPool = ALL_CARDS.filter((card) => card.elixir === targetElixir)
    const fillerPool = ALL_CARDS.filter((card) => card.elixir !== targetElixir)
    const usedIds = new Set<number>()
    const targetCount = Math.min(targetPool.length, 2 + Math.floor(Math.random() * 2))
    const cards: Card[] = []

    for (let i = 0; i < targetCount; i += 1) cards.push(drawFrom(targetPool, usedIds))
    while (cards.length < SWEEP.BOARD_SIZE) cards.push(drawFrom(fillerPool, usedIds))

    return { cards: shuffle(cards), targetElixir }
  }

  function dealRun() {
    timed.reset('ready')
    recent.current = []
    seen.current = new Set()
    answers.current = []
    finished.current = false
    serverBoards.current = []
    serverBoardIndex.current = 0
    serverPicks.current = []
    imagesReady.value = false
    selectedIds.value = new Set()
    wrongIds.value = new Set()
    found.value = 0
    boardsCleared.value = 0
    wrongTaps.value = 0
    boardLocked.value = false
    insights.value = null
    isPB.value = false
    prevBest.value = undefined

    const next = makeBoard()
    board.value = next
    preloadImages(next.cards, () => (imagesReady.value = true))
  }

  function start() {
    timed.start((startedAt) => {
      runStartedAt.current = startedAt
      serverPicks.current = []
      finished.current = false
      selectedIds.value = new Set()
      wrongIds.value = new Set()
      boardLocked.value = false
    })
  }

  function nextBoard() {
    if (stage.value !== 'running' || finished.current) return
    serverBoardIndex.current += 1
    const next = serverBoards.current[serverBoardIndex.current] ?? makeBoard()
    board.value = next
    selectedIds.value = new Set()
    wrongIds.value = new Set()
    boardLocked.value = false
    preloadImages(next.cards, () => {})
  }

  function finish() {
    if (finished.current) return
    finished.current = true
    timed.clearScheduled()

    const best = getRecords().costSweepBest
    const pb = best === undefined || found.value > best
    const ins = computeInsights(answers.current)

    insights.value = ins
    prevBest.value = best
    isPB.value = pb
    remainingMs.value = 0

    if (pb) {
      saveRecords({ costSweepBest: found.value })
      track('record.new')
    }

    track('costsweep.complete')
    elixirLine.value = pb
      ? `${found.value} found. New Cost Sweep best.`
      : `${found.value} found. Scan the target cost first, then trust the taps.`
    timed.setStage('summary')
    void gameRun.complete({ picks: serverPicks.current })
  }

  function pick(card: Card) {
    const currentBoard = board.value
    if (stage.value !== 'running' || !currentBoard || boardLocked.value || selectedIds.value.has(card.id)) return
    serverPicks.current.push({
      boardIndex: serverBoardIndex.current,
      cardId: card.id,
      atMs: performance.now() - runStartedAt.current
    })

    if (card.elixir === currentBoard.targetElixir) {
      playCorrect()
      const nextSelected = new Set(selectedIds.value)
      nextSelected.add(card.id)
      selectedIds.value = nextSelected
      found.value += 1
      answers.current.push({ card, guess: currentBoard.targetElixir, correct: true })
      saveResult(card.id, true)

      if (isSweepComplete(currentBoard.cards, currentBoard.targetElixir, nextSelected)) {
        boardsCleared.value += 1
        boardLocked.value = true
        later(nextBoard, SWEEP.BOARD_CLEAR_BEAT_MS)
      }
      return
    }

    playWrong()
    wrongTaps.value += 1
    timed.addPenalty(SWEEP.WRONG_PENALTY_MS)
    answers.current.push({ card, guess: currentBoard.targetElixir, correct: false })
    saveResult(card.id, false)

    const nextWrong = new Set(wrongIds.value)
    nextWrong.add(card.id)
    wrongIds.value = nextWrong
    later(() => {
      const cleared = new Set(wrongIds.value)
      cleared.delete(card.id)
      wrongIds.value = cleared
    }, SWEEP.WRONG_BEAT_MS)
  }

  function replay() {
    dealRun()
    void gameRun.prepare()
  }

  if (!gameRun.challenge.value) {
    return (
      <GameRunGate
        preparing={gameRun.preparing.value}
        error={gameRun.startError.value}
        onRetry={() => void gameRun.prepare()}
      />
    )
  }

  if (stage.value === 'summary' && insights.value) {
    const pbCallout = isPB.value
      ? prevBest.value !== undefined
        ? `New best! +${found.value - prevBest.value}`
        : 'First Sweep logged'
      : prevBest.value !== undefined
        ? `Best: ${prevBest.value}`
        : undefined

    return (
      <div class="main-content">
        <Summary
          eyebrow="Cost Sweep complete · 45s"
          headline={`${found.value} found`}
          pbCallout={pbCallout}
          elixirLine={elixirLine.value}
          elixirMood={isPB.value ? 'celebrate' : 'thinking'}
          insights={insights.value}
          onReplay={replay}
          replayLabel="Sweep again"
          onHome={() => navigate('/')}
        >
          <div class="sweep-summary-line">
            {boardsCleared.value} boards cleared · {wrongTaps.value} wrong taps
          </div>
          <ShareLine text={`Cost Sweep: ${found.value} cards found in 45s — drop.poapkings.com`} />
          {isPB.value && found.value >= 12 && <Recruit />}
        </Summary>
      </div>
    )
  }

  if (stage.value === 'ready') {
    return (
      <div class="main-content sweep">
        <div class="surge-ready sweep-ready">
          <div class="eyebrow">Cost Sweep · Scan and recall</div>
          <h1 class="h1">Tap every card with the target cost.</h1>
          <p class="lede">
            A grid appears with one elixir value to hunt. Clear every matching card, then the next board drops in. Wrong
            taps cost <strong>{(SWEEP.WRONG_PENALTY_MS / 1000).toFixed(0)}s</strong>.
          </p>
          <button
            class="btn btn--gold surge-ready__go"
            onClick={start}
            disabled={!imagesReady.value || gameRun.preparing.value}
          >
            {imagesReady.value ? 'Start Cost Sweep' : 'Loading cards…'}
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
      <div class="main-content game-run sweep">
        <div class="surge-countdown" aria-live="assertive">
          {count.value}
        </div>
        <p class="lede">Find the target cost…</p>
      </div>
    )
  }

  const currentBoard = board.value
  const seconds = Math.ceil(remainingMs.value / 1000)
  const remainingTargets = currentBoard
    ? remainingTargetIds(currentBoard.cards, currentBoard.targetElixir, selectedIds.value).length
    : 0

  return (
    <div class="main-content game-run sweep" style={{ alignItems: 'center', gap: 18 }}>
      <div class="surge-hud sweep-hud">
        <div class={`surge-hud__timer${seconds <= 10 ? ' surge-hud__timer--low' : ''}`} aria-label="time remaining">
          {seconds}
          <span class="surge-hud__unit">s</span>
        </div>
        <div class="surge-hud__count">
          {found.value} found · {boardsCleared.value} boards
        </div>
      </div>

      {currentBoard && (
        <>
          <div class="sweep-target" aria-live="polite">
            <span>Tap every</span>
            <strong>
              <img src="/assets/elixir-drop.png" alt="" class="elixir-pip" aria-hidden="true" />
              {currentBoard.targetElixir}
            </strong>
            <span>{remainingTargets} left</span>
          </div>

          <div class="progress-track sweep-progress" aria-hidden="true">
            <div class="progress-track__fill" style={{ width: `${(remainingMs.value / SWEEP.WINDOW_MS) * 100}%` }} />
          </div>

          <div class="sweep-grid" aria-label={`Cost Sweep cards for ${currentBoard.targetElixir} elixir`}>
            {currentBoard.cards.map((card) => (
              <SweepCard
                key={card.id}
                card={card}
                isTarget={card.elixir === currentBoard.targetElixir}
                isFound={selectedIds.value.has(card.id)}
                isWrong={wrongIds.value.has(card.id)}
                disabled={boardLocked.value}
                onPick={pick}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
