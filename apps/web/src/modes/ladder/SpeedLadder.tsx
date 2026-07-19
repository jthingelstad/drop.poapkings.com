import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { JSX } from 'preact'
import type { Card } from '../../types'
import { getRecords, saveRecords } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { formatSeconds } from '../../lib/format'
import { ladderSummaryLine } from '../../lib/mode-insights'
import { useTimedRun } from '../../lib/use-timed-run'
import { isAscendingByElixir, pickLadderHintCard, reorderCards } from '../../lib/ladder'
import { CardArt, CardName, ElixirCostBadge } from '../../components/CardChrome'
import ElixirHost from '../../components/ElixirHost'
import Icon from '../../components/Icon'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'
import GameRunGate from '../../components/GameRunGate'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'

const LADDER = {
  SIZE: 5,
  PENALTY_MS: 2000
}

const COUNTDOWN_STEP_MS = 650
const WRONG_BEAT_MS = 720
const SOLVE_REVEAL_MS = 1100

type Feedback = 'idle' | 'wrong' | 'solved'

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

      <CardArt
        card={card}
        className="ladder-card__art"
        imgClassName="ladder-card__img"
        fallbackClassName="ladder-card__fallback"
        showCost={isRevealed}
        costClassName="ladder-card__cost"
      />

      <span class="ladder-card__details">
        <CardName card={card} className="ladder-card__title" />
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
          <Icon name="chevron-up" />
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
          <Icon name="chevron-down" />
        </button>
      </span>
    </li>
  )
}

export default function SpeedLadder() {
  const gameRun = useGameSession('ladder', challengePreparers.ladder)
  const draggedId = useRef<number | null>(null)
  const suppressTapUntil = useRef(0)
  const runStartedAt = useRef(0)
  const serverAttempts = useRef<Array<{ order: number[]; atMs: number }>>([])

  const timed = useTimedRun({ countdownStepMs: COUNTDOWN_STEP_MS })
  const { stage, count, elapsedMs, later } = timed
  const order = useSignal<Card[]>([])
  const revealedIds = useSignal<Set<number>>(new Set())
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
  }, [])

  async function start() {
    if (!(await gameRun.ensureFreshRun())) return
    if (!gameRun.content) return
    order.value = [...gameRun.content]
    timed.start((startedAt) => {
      runStartedAt.current = startedAt
      serverAttempts.current = []
      wrongLocks.value = 0
      feedback.value = 'idle'
      hintedOnLastLock.value = false
      revealedIds.value = new Set()
      selectedCard.value = null
    })
  }

  function moveCard(fromIndex: number, toIndex: number) {
    if (stage.value !== 'running' || feedback.value !== 'idle') return
    order.value = reorderCards(order.value, fromIndex, toIndex)
  }

  function tapCard(cardId: number, index: number) {
    if (stage.value !== 'running' || feedback.value !== 'idle') return
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
    if (stage.value !== 'running' || feedback.value !== 'idle') return

    const atMs = performance.now() - runStartedAt.current
    const correct = isAscendingByElixir(order.value)
    // Mirror the server's transcript cap: wrong locks beyond it still
    // penalize locally but are no longer recorded, so a struggling
    // beginner's eventual solve is not voided.
    if (correct || serverAttempts.current.length < 59)
      serverAttempts.current.push({ order: order.value.map((card) => card.id), atMs })

    if (!correct) {
      playWrong()
      const hintedCardId = pickLadderHintCard(order.value, revealedIds.value)
      if (hintedCardId !== undefined) {
        const next = new Set(revealedIds.value)
        next.add(hintedCardId)
        revealedIds.value = next
      }
      hintedOnLastLock.value = hintedCardId !== undefined
      wrongLocks.value += 1
      timed.addPenalty(LADDER.PENALTY_MS)
      feedback.value = 'wrong'
      selectedCard.value = null
      later(() => (feedback.value = 'idle'), WRONG_BEAT_MS)
      return
    }

    playCorrect()
    selectedCard.value = null
    // Freeze the board during the solve reveal; the transcript is final.
    feedback.value = 'solved'
    const total = Math.round(atMs) + (serverAttempts.current.length - 1) * LADDER.PENALTY_MS
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
    elixirLine.value = ladderSummaryLine({
      isPB: pb,
      totalMs: total,
      wrongLocks: wrongLocks.value
    })
    // The player just built the ladder — flash every cost in final order so
    // they see it confirmed before the summary takes over. The score was
    // captured above; this beat costs nothing.
    revealedIds.value = new Set(order.value.map((card) => card.id))
    later(() => timed.setStage('summary'), SOLVE_REVEAL_MS)
    void gameRun.complete({ attempts: serverAttempts.current })
  }

  function replay() {
    timed.reset('ready')
    draggedId.current = null
    draggingCard.value = null
    selectedCard.value = null
    serverAttempts.current = []
    order.value = []
    revealedIds.value = new Set()
    wrongLocks.value = 0
    feedback.value = 'idle'
    hintedOnLastLock.value = false
    isPB.value = false
    prevBest.value = undefined
    totalMs.value = 0
    void gameRun.prepare()
  }

  if (!gameRun.content) {
    return (
      <GameRunGate preparing={gameRun.preparing.value} error={gameRun.error} onRetry={() => void gameRun.prepare()} />
    )
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
                <CardName card={card} className="summary-chip__name" />
                <ElixirCostBadge elixir={card.elixir} className="summary-chip__cost" />
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
          <button
            class="btn btn--gold surge-ready__go"
            onClick={start}
            disabled={!gameRun.assetsReady || gameRun.preparing.value}
          >
            {gameRun.assetsReady ? 'Start Speed Ladder' : 'Loading cards…'}
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
            disabled={feedback.value !== 'idle'}
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
        <button class="btn btn--gold ladder-actions__lock" onClick={lockOrder} disabled={feedback.value !== 'idle'}>
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
