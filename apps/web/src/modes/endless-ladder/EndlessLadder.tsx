import { useSignal } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import type { Card, CardsData } from '../../types'
import rawCards from '@elixir-drop/game-data/cards.json'
import { sampleUnseenCard } from '../../lib/sampling'
import { getRecords, saveRecords, saveResult } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { preloadImages } from '../../lib/preload'
import { computeInsights, type Answer, type Insights } from '../../lib/insights'
import { canInsertAt, insertAtSlot } from '../../lib/endless-ladder'
import { clearTimers, schedule } from '../../lib/run-loop'
import CardDisplay from '../../components/CardDisplay'
import { CardArt, CardName, ElixirCostBadge } from '../../components/CardChrome'
import ElixirHost from '../../components/ElixirHost'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'
import GameRunGate from '../../components/GameRunGate'
import { useGameRun } from '../../lib/use-game-run'
import { challengeCards } from '../../lib/challenge-cards'

const cardsData = rawCards as CardsData
const ALL_CARDS = cardsData.cards

const ENDLESS = {
  STARTING_CARDS: 2,
  CORRECT_BEAT_MS: 260,
  WRONG_BEAT_MS: 760
}

type Stage = 'ready' | 'running' | 'over'
type CardPhase = 'playing' | 'correct' | 'wrong'

function sortByElixir(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.elixir - b.elixir || a.name.localeCompare(b.name))
}

function EndlessRowCard({ card, revealCost }: { card: Card; revealCost: boolean }) {
  return (
    <div class="endless-card" data-card-id={card.id}>
      <CardArt
        card={card}
        className="endless-card__art"
        imgClassName="endless-card__img"
        fallbackClassName="endless-card__fallback"
        showCost={revealCost}
        costClassName="ladder-card__cost"
      />
      <CardName card={card} className="endless-card__name" />
    </div>
  )
}

export default function EndlessLadder() {
  const gameRun = useGameRun('endless-ladder')
  const timers = useRef<number[]>([])
  const recent = useRef<number[]>([])
  const seen = useRef<Set<number>>(new Set())
  const answers = useRef<Answer[]>([])
  const cardStart = useRef(0)
  const best = useSignal(getRecords().endlessLadderBest ?? 0)
  const serverCards = useRef<Card[]>([])
  const serverCardIndex = useRef(0)
  const serverAttempts = useRef<Array<{ cardId: number; slotIndex: number }>>([])

  const stage = useSignal<Stage>('ready')
  const imagesReady = useSignal(false)
  const row = useSignal<Card[]>([])
  const current = useSignal<Card | null>(null)
  const cardPhase = useSignal<CardPhase>('playing')
  const dropKey = useSignal(0)
  const inserts = useSignal(0)
  const failedSlot = useSignal<number | null>(null)
  const insights = useSignal<Insights | null>(null)
  const isPB = useSignal(false)
  const elixirLine = useSignal('')

  useEffect(() => {
    const timerList = timers.current
    track('mode.endless')
    dealRun()
    return () => clearTimers(timerList)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    const challenge = gameRun.challenge.value
    if (!challenge || stage.value === 'running') return
    const starting = challengeCards(challenge.startingIds)
    const incoming = challengeCards(challenge.cardIds)
    if (starting.length !== challenge.startingIds.length || !incoming.length) return
    serverCards.current = incoming
    serverCardIndex.current = 1
    serverAttempts.current = []
    row.value = sortByElixir(starting)
    current.value = incoming[0]!
    imagesReady.value = false
    preloadImages([...row.value, incoming[0]!], () => (imagesReady.value = true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameRun.challenge.value])

  function drawCard(): Card {
    const serverCard = serverCards.current[serverCardIndex.current]
    if (serverCard) {
      serverCardIndex.current += 1
      return serverCard
    }
    const card = sampleUnseenCard(ALL_CARDS, seen.current, recent.current)
    recent.current.push(card.id)
    if (recent.current.length > 8) recent.current.shift()
    return card
  }

  function dealRun() {
    clearTimers(timers.current)
    recent.current = []
    seen.current = new Set()
    answers.current = []
    serverCards.current = []
    serverCardIndex.current = 0
    serverAttempts.current = []
    imagesReady.value = false
    insights.value = null
    failedSlot.value = null
    isPB.value = false
    inserts.value = 0
    cardPhase.value = 'playing'

    const seed: Card[] = []
    for (let i = 0; i < ENDLESS.STARTING_CARDS; i += 1) seed.push(drawCard())

    for (let tries = 0; tries < 8 && new Set(seed.map((card) => card.elixir)).size < 2; tries += 1) {
      seed[seed.length - 1] = drawCard()
    }

    row.value = sortByElixir(seed)
    current.value = drawCard()
    stage.value = 'ready'
    preloadImages([...row.value, current.value], () => (imagesReady.value = true))
  }

  function later(fn: () => void, ms: number) {
    schedule(timers.current, fn, ms)
  }

  function start() {
    if (!current.value) return
    cardStart.current = performance.now()
    cardPhase.value = 'playing'
    stage.value = 'running'
  }

  function nextCard() {
    if (stage.value !== 'running') return
    const card = drawCard()
    current.value = card
    cardPhase.value = 'playing'
    cardStart.current = performance.now()
    preloadImages([card], () => {})
  }

  function finish(slotIndex: number) {
    const card = current.value
    if (card) {
      answers.current.push({ card, guess: slotIndex, correct: false, ms: performance.now() - cardStart.current })
      saveResult(card.id, false)
    }

    const prev = getRecords().endlessLadderBest
    const pb = inserts.value > (prev ?? 0)
    const ins = computeInsights(answers.current)

    insights.value = ins
    failedSlot.value = slotIndex
    isPB.value = pb

    if (pb) {
      saveRecords({ endlessLadderBest: inserts.value })
      best.value = inserts.value
      track('record.new')
    }

    track('endless.complete')
    elixirLine.value = pb
      ? `${inserts.value} inserts. New Endless Ladder best.`
      : `${inserts.value} inserts. The slot math broke first; rebuild from the anchors.`
    stage.value = 'over'
    void gameRun.complete({ attempts: serverAttempts.current })
  }

  function insert(slotIndex: number) {
    if (stage.value !== 'running' || cardPhase.value !== 'playing') return
    const card = current.value
    if (!card) return
    serverAttempts.current.push({ cardId: card.id, slotIndex })

    if (!canInsertAt(row.value, card, slotIndex)) {
      playWrong()
      cardPhase.value = 'wrong'
      later(() => finish(slotIndex), ENDLESS.WRONG_BEAT_MS)
      return
    }

    playCorrect()
    const ms = performance.now() - cardStart.current
    answers.current.push({ card, guess: slotIndex, correct: true, ms })
    saveResult(card.id, true, ms)
    row.value = insertAtSlot(row.value, card, slotIndex)
    inserts.value += 1
    cardPhase.value = 'correct'
    dropKey.value += 1
    later(nextCard, ENDLESS.CORRECT_BEAT_MS)
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

  if (stage.value === 'over' && insights.value) {
    const pbCallout = isPB.value ? 'New personal best!' : best.value > 0 ? `Best: ${best.value}` : undefined
    const failed = current.value

    return (
      <div class="main-content endless">
        <div class="ladder-result endless-result">
          <div class="eyebrow">Endless Ladder complete</div>
          <div class="ladder-result__time">
            {inserts.value}
            <span>inserts</span>
          </div>
          {pbCallout && <div class="summary__pb">{pbCallout}</div>}
          {failed && (
            <div class="endless-result__failed">
              <span>Missed slot {failedSlot.value !== null ? failedSlot.value + 1 : '—'} for</span>
              <span class="summary-chip">
                <CardName card={failed} className="summary-chip__name" />
                <ElixirCostBadge elixir={failed.elixir} className="summary-chip__cost" />
              </span>
            </div>
          )}

          <ElixirHost line={elixirLine.value} mood={isPB.value ? 'celebrate' : 'thinking'} />

          <div class="ladder-result__order" aria-label="Final ladder order">
            {row.value.map((card) => (
              <span class="summary-chip" key={card.id}>
                <CardName card={card} className="summary-chip__name" />
                <ElixirCostBadge elixir={card.elixir} className="summary-chip__cost" />
              </span>
            ))}
          </div>

          <ShareLine text={`Endless Ladder: ${inserts.value} inserts — drop.poapkings.com`} />
          {isPB.value && inserts.value >= 8 && <Recruit />}

          <div class="summary__actions">
            <button class="btn btn--gold" onClick={replay}>
              Climb again
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
      <div class="main-content endless">
        <div class="surge-ready endless-ready">
          <div class="eyebrow">Endless Ladder · Insert sort</div>
          <h1 class="h1">Grow the ladder one card at a time.</h1>
          <p class="lede">
            A new card arrives with its cost hidden. Insert it into the low-to-high row. One wrong slot ends the climb.
          </p>
          <button
            class="btn btn--gold surge-ready__go"
            onClick={start}
            disabled={!imagesReady.value || gameRun.preparing.value}
          >
            {imagesReady.value ? 'Start Endless Ladder' : 'Loading cards…'}
          </button>
          <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
            Back
          </button>
        </div>
      </div>
    )
  }

  const card = current.value

  return (
    <div class="main-content game-run endless" style={{ alignItems: 'center', gap: 18 }}>
      <div class="surge-hud ladder-hud">
        <div class="surge-hud__timer" aria-label="successful inserts">
          {inserts.value}
        </div>
        <div class="surge-hud__count">inserts · best {best.value}</div>
      </div>

      {card && (
        <div class="endless-current" data-testid="endless-current-card" data-card-id={card.id}>
          <div class="eyebrow">Place this card</div>
          <CardDisplay
            card={card}
            phase={cardPhase.value}
            dropAnimKey={dropKey.value}
            revealCost={cardPhase.value === 'wrong'}
            showMeta={false}
          />
        </div>
      )}

      <div class="ladder-rail endless-rail" aria-hidden="true">
        <span>low</span>
        <span>high</span>
      </div>

      <div class="endless-track" aria-label="Endless Ladder insertion slots">
        <button
          type="button"
          class={`endless-slot${failedSlot.value === 0 ? ' endless-slot--wrong' : ''}`}
          onClick={() => insert(0)}
          disabled={cardPhase.value !== 'playing'}
          data-testid="endless-slot"
          data-slot-index={0}
        >
          Insert before
        </button>
        {row.value.map((rowCard, index) => (
          <div class="endless-step" key={rowCard.id}>
            <EndlessRowCard card={rowCard} revealCost={stage.value === 'over'} />
            <button
              type="button"
              class={`endless-slot${failedSlot.value === index + 1 ? ' endless-slot--wrong' : ''}`}
              onClick={() => insert(index + 1)}
              disabled={cardPhase.value !== 'playing'}
              data-testid="endless-slot"
              data-slot-index={index + 1}
            >
              {index === row.value.length - 1 ? 'Insert after' : 'Insert here'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
