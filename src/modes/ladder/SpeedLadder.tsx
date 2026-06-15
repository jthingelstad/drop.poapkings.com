import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { JSX } from 'preact'
import type { Card, CardsData } from '../../types'
import rawCards from '../../data/cards.json'
import { sampleUnseenCard } from '../../lib/sampling'
import { getRecords, saveRecords } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { formatSeconds } from '../../lib/format'
import { preloadImages } from '../../lib/preload'
import { isAscendingByElixir, pickLadderHintCard, reorderCards } from '../../lib/ladder'
import ElixirHost from '../../components/ElixirHost'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'

const cardsData = rawCards as CardsData
const ALL_CARDS = cardsData.cards

const LADDER = {
  SIZE: 5,
  PENALTY_MS: 2000
}

const COUNTDOWN_STEP_MS = 650
const WRONG_BEAT_MS = 720

type Stage = 'ready' | 'countdown' | 'running' | 'summary'
type Feedback = 'idle' | 'wrong'

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

function pickLadderCards(): Card[] {
  const chosen: Card[] = []
  const seen = new Set<number>()
  const recent: number[] = []

  while (chosen.length < LADDER.SIZE) {
    const card = sampleUnseenCard(ALL_CARDS, seen, recent)
    chosen.push(card)
    recent.push(card.id)
    if (recent.length > 6) recent.shift()
  }

  if (new Set(chosen.map((card) => card.elixir)).size < 2) {
    const replacement = ALL_CARDS.find((card) => card.elixir !== chosen[0].elixir && !seen.has(card.id))
    if (replacement) chosen[LADDER.SIZE - 1] = replacement
  }

  for (let i = 0; i < 6; i += 1) {
    const shuffled = shuffle(chosen)
    if (!isAscendingByElixir(shuffled)) return shuffled
  }

  return [...chosen].sort((a, b) => b.elixir - a.elixir || b.name.localeCompare(a.name))
}

function pluralizeMisses(count: number): string {
  return `${count} ${count === 1 ? 'miss' : 'misses'}`
}

function LadderCard({
  card,
  index,
  total,
  disabled,
  isDragging,
  isRevealed,
  isSelected,
  onMove,
  onTap,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  card: Card
  index: number
  total: number
  disabled: boolean
  isDragging: boolean
  isRevealed: boolean
  isSelected: boolean
  onMove: (fromIndex: number, toIndex: number) => void
  onTap: (cardId: number, index: number) => void
  onDragStart: (cardId: number, event: JSX.TargetedDragEvent<HTMLLIElement>) => void
  onDragOver: (event: JSX.TargetedDragEvent<HTMLLIElement>) => void
  onDrop: (toIndex: number, event: JSX.TargetedDragEvent<HTMLLIElement>) => void
  onDragEnd: () => void
}) {
  const imageFailed = useSignal(false)
  const showImage = card.icon && !imageFailed.value

  return (
    <li
      class={`ladder-card${isDragging ? ' ladder-card--dragging' : ''}${isSelected ? ' ladder-card--selected' : ''}${isRevealed ? ' ladder-card--revealed' : ''}`}
      data-card-id={card.id}
      data-revealed={isRevealed ? 'true' : 'false'}
      data-testid="ladder-card"
      draggable={!disabled}
      onClick={() => onTap(card.id, index)}
      onDragStart={(event) => onDragStart(card.id, event)}
      onDragOver={onDragOver}
      onDrop={(event) => onDrop(index, event)}
      onDragEnd={onDragEnd}
    >
      <span class="ladder-card__rank" aria-hidden="true">
        {index + 1}
      </span>

      <span class="ladder-card__art">
        {showImage ? (
          <img
            class="ladder-card__img"
            src={card.icon}
            alt=""
            loading="lazy"
            onError={() => (imageFailed.value = true)}
          />
        ) : (
          <span class="ladder-card__fallback" aria-hidden="true" />
        )}
        {isRevealed && (
          <span class="ladder-card__cost" aria-label={`${card.elixir} elixir`}>
            <img src="/assets/elixir-drop.png" alt="" class="elixir-pip" />
            {card.elixir}
          </span>
        )}
      </span>

      <span class="ladder-card__details">
        <span class="ladder-card__title">{card.name}</span>
        <span class="ladder-card__sub">
          {card.rarity} {card.type}
        </span>
      </span>

      <span class="ladder-card__controls" aria-label={`${card.name} position controls`}>
        <button
          type="button"
          class="ladder-card__move"
          onClick={(event) => {
            event.stopPropagation()
            onMove(index, index - 1)
          }}
          disabled={disabled || index === 0}
          aria-label={`Move ${card.name} earlier`}
          title="Move earlier"
        >
          ↑
        </button>
        <button
          type="button"
          class="ladder-card__move"
          onClick={(event) => {
            event.stopPropagation()
            onMove(index, index + 1)
          }}
          disabled={disabled || index === total - 1}
          aria-label={`Move ${card.name} later`}
          title="Move later"
        >
          ↓
        </button>
      </span>
    </li>
  )
}

export default function SpeedLadder() {
  const timers = useRef<number[]>([])
  const startTime = useRef(0)
  const penaltyMs = useRef(0)
  const draggedId = useRef<number | null>(null)
  const suppressTapUntil = useRef(0)

  const stage = useSignal<Stage>('ready')
  const imagesReady = useSignal(false)
  const count = useSignal(3)
  const order = useSignal<Card[]>(pickLadderCards())
  const revealedIds = useSignal<Set<number>>(new Set())
  const elapsedMs = useSignal(0)
  const wrongLocks = useSignal(0)
  const feedback = useSignal<Feedback>('idle')
  const hintedOnLastLock = useSignal(false)
  const totalMs = useSignal(0)
  const isPB = useSignal(false)
  const prevBest = useSignal<number | undefined>(undefined)
  const elixirLine = useSignal('')
  const draggingCard = useSignal<number | null>(null)
  const selectedCard = useSignal<number | null>(null)

  useEffect(() => {
    track('mode.ladder')
    preloadImages(order.value, () => (imagesReady.value = true))
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
    wrongLocks.value = 0
    feedback.value = 'idle'
    hintedOnLastLock.value = false
    revealedIds.value = new Set()
    selectedCard.value = null
    stage.value = 'running'
  }

  function moveCard(fromIndex: number, toIndex: number) {
    if (stage.value !== 'running' || feedback.value === 'wrong') return
    order.value = reorderCards(order.value, fromIndex, toIndex)
  }

  function tapCard(cardId: number, index: number) {
    if (stage.value !== 'running' || feedback.value === 'wrong') return
    if (performance.now() < suppressTapUntil.current) return

    if (selectedCard.value === null) {
      selectedCard.value = cardId
      return
    }

    if (selectedCard.value === cardId) {
      selectedCard.value = null
      return
    }

    const fromIndex = order.value.findIndex((card) => card.id === selectedCard.value)
    moveCard(fromIndex, index)
    selectedCard.value = null
  }

  function handleDragStart(cardId: number, event: JSX.TargetedDragEvent<HTMLLIElement>) {
    draggedId.current = cardId
    draggingCard.value = cardId
    selectedCard.value = null
    event.dataTransfer?.setData('text/plain', String(cardId))
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(event: JSX.TargetedDragEvent<HTMLLIElement>) {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  function handleDrop(toIndex: number, event: JSX.TargetedDragEvent<HTMLLIElement>) {
    event.preventDefault()
    const id = draggedId.current
    if (id === null) return
    const fromIndex = order.value.findIndex((card) => card.id === id)
    moveCard(fromIndex, toIndex)
    draggedId.current = null
    draggingCard.value = null
    selectedCard.value = null
  }

  function handleDragEnd() {
    draggedId.current = null
    draggingCard.value = null
    suppressTapUntil.current = performance.now() + 160
  }

  function lockOrder() {
    if (stage.value !== 'running' || feedback.value === 'wrong') return

    if (!isAscendingByElixir(order.value)) {
      playWrong()
      const hintedCardId = pickLadderHintCard(order.value, revealedIds.value)
      if (hintedCardId !== undefined) {
        const next = new Set(revealedIds.value)
        next.add(hintedCardId)
        revealedIds.value = next
      }
      hintedOnLastLock.value = hintedCardId !== undefined
      wrongLocks.value += 1
      penaltyMs.current += LADDER.PENALTY_MS
      feedback.value = 'wrong'
      selectedCard.value = null
      later(() => (feedback.value = 'idle'), WRONG_BEAT_MS)
      return
    }

    playCorrect()
    selectedCard.value = null
    const total = performance.now() - startTime.current + penaltyMs.current
    const best = getRecords().ladderBest
    const pb = best === undefined || total < best
    totalMs.value = total
    prevBest.value = best
    isPB.value = pb

    if (pb) {
      saveRecords({ ladderBest: total })
      track('record.new')
    }
    track('ladder.complete')
    elixirLine.value = pb
      ? `New Ladder best: ${formatSeconds(total)}s. Sorted hands win trades.`
      : `${formatSeconds(total)}s. Clean order. Now do it faster.`
    stage.value = 'summary'
  }

  function replay() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    draggedId.current = null
    draggingCard.value = null
    selectedCard.value = null
    const next = pickLadderCards()
    order.value = next
    revealedIds.value = new Set()
    imagesReady.value = false
    count.value = 3
    elapsedMs.value = 0
    wrongLocks.value = 0
    penaltyMs.current = 0
    feedback.value = 'idle'
    hintedOnLastLock.value = false
    isPB.value = false
    prevBest.value = undefined
    totalMs.value = 0
    stage.value = 'ready'
    preloadImages(next, () => (imagesReady.value = true))
  }

  if (stage.value === 'summary') {
    const pbCallout = isPB.value
      ? prevBest.value !== undefined
        ? `New best! −${formatSeconds(prevBest.value - totalMs.value)}s`
        : 'First Ladder logged'
      : prevBest.value !== undefined
        ? `Best: ${formatSeconds(prevBest.value)}s`
        : undefined

    return (
      <div class="main-content ladder">
        <div class="ladder-result">
          <div class="eyebrow">Speed Ladder complete</div>
          <div class="ladder-result__time">
            {formatSeconds(totalMs.value)}
            <span>s</span>
          </div>
          {pbCallout && <div class="summary__pb">{pbCallout}</div>}
          <div class="ladder-result__misses">{pluralizeMisses(wrongLocks.value)} · sorted low to high</div>

          <ElixirHost line={elixirLine.value} mood={isPB.value ? 'celebrate' : 'gg'} />

          <div class="ladder-result__order" aria-label="Final sorted order">
            {order.value.map((card) => (
              <span class="summary-chip" key={card.id}>
                <span class="summary-chip__name">{card.name}</span>
                <span class="summary-chip__cost">
                  <img src="/assets/elixir-drop.png" alt="" class="elixir-pip" aria-hidden="true" />
                  {card.elixir}
                </span>
              </span>
            ))}
          </div>

          <ShareLine
            text={`Speed Ladder: ${LADDER.SIZE} cards in ${formatSeconds(totalMs.value)}s — drop.poapkings.com`}
          />
          {isPB.value && <Recruit />}

          <div class="summary__actions">
            <button class="btn btn--gold" onClick={replay}>
              Run Ladder again
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
      <div class="main-content ladder">
        <div class="surge-ready ladder-ready">
          <div class="eyebrow">Ladder · Speed sort</div>
          <h1 class="h1">Sort five cards by elixir.</h1>
          <p class="lede">
            Lowest cost to highest cost. Lock the order when it feels right. A wrong lock adds{' '}
            <strong>+{(LADDER.PENALTY_MS / 1000).toFixed(0)}s</strong>.
          </p>
          <button class="btn btn--gold surge-ready__go" onClick={start} disabled={!imagesReady.value}>
            {imagesReady.value ? 'Start Speed Ladder' : 'Loading cards…'}
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
      <div class="main-content game-run ladder">
        <div class="surge-countdown" aria-live="assertive">
          {count.value}
        </div>
        <p class="lede">Get ready…</p>
      </div>
    )
  }

  return (
    <div class="main-content game-run ladder" style={{ alignItems: 'center', gap: 18 }}>
      <div class="surge-hud ladder-hud">
        <div class="surge-hud__timer" aria-label="elapsed time">
          {formatSeconds(elapsedMs.value)}
          <span class="surge-hud__unit">s</span>
        </div>
        <div class="surge-hud__count">{wrongLocks.value ? `+${wrongLocks.value} lock` : `${LADDER.SIZE} cards`}</div>
      </div>

      <div class="ladder-rail" aria-hidden="true">
        <span>low</span>
        <span>high</span>
      </div>

      <ol class={`ladder-board ladder-board--${feedback.value}`} aria-label="Speed Ladder card order">
        {order.value.map((card, index) => (
          <LadderCard
            key={card.id}
            card={card}
            index={index}
            total={order.value.length}
            disabled={feedback.value === 'wrong'}
            isDragging={draggingCard.value === card.id}
            isRevealed={revealedIds.value.has(card.id)}
            isSelected={selectedCard.value === card.id}
            onMove={moveCard}
            onTap={tapCard}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
          />
        ))}
      </ol>

      <div class="ladder-actions">
        <button class="btn btn--gold ladder-actions__lock" onClick={lockOrder} disabled={feedback.value === 'wrong'}>
          Lock order
        </button>
        <div class="ladder-actions__feedback" aria-live="polite">
          {feedback.value === 'wrong'
            ? `${hintedOnLastLock.value ? 'Cost revealed' : 'Not sorted'}. +${(LADDER.PENALTY_MS / 1000).toFixed(0)}s`
            : ' '}
        </div>
      </div>
    </div>
  )
}
