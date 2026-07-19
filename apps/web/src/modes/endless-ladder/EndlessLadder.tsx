import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card } from '../../types'
import { getRecords, saveResult } from '../../lib/storage'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { preloadImages } from '../../lib/preload'
import { computeInsights, type Answer, type Insights } from '../../lib/insights'
import { canInsertAt, insertAtSlot } from '../../lib/endless-ladder'
import { useGameRuntime } from '../../lib/use-game-runtime'
import CardDisplay from '../../components/CardDisplay'
import { CardArt, CardName, ElixirCostBadge } from '../../components/CardChrome'
import ElixirHost from '../../components/ElixirHost'
import ShareLine from '../../components/ShareLine'
import Recruit from '../../components/Recruit'
import GameRunGate from '../../components/GameRunGate'
import GameMotion from '../../components/GameMotion'
import GameFxLayer, { preloadGameFx } from '../../components/GameFxLayer'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'

const ENDLESS = {
  STARTING_CARDS: 2,
  CORRECT_BEAT_MS: 260,
  // Long enough to read the death reveal: every cost shows and the slots
  // that would have worked light up.
  WRONG_BEAT_MS: 1400
}

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
  const gameRun = useGameSession('endless-ladder', challengePreparers['endless-ladder'])
  const answers = useRef<Answer[]>([])
  const cardStart = useRef(0)
  const best = useSignal(getRecords().endlessLadderBest ?? 0)
  const serverCardIndex = useRef(0)
  const serverAttempts = useRef<Array<{ cardId: number; slotIndex: number }>>([])

  const runtime = useGameRuntime()
  const { stage, later } = runtime
  const row = useSignal<Card[]>([])
  const current = useSignal<Card | null>(null)
  const cardPhase = useSignal<CardPhase>('playing')
  const dropKey = useSignal(0)
  const inserts = useSignal(0)
  const failedSlot = useSignal<number | null>(null)
  // Death reveal: show all costs and highlight the slots that were valid.
  const revealOutcome = useSignal(false)
  const insights = useSignal<Insights | null>(null)
  const isPB = useSignal(false)
  const elixirLine = useSignal('')

  useEffect(() => {
    track('mode.endless')
    preloadGameFx()
  }, [])

  function drawCard(): Card | undefined {
    const serverCard = gameRun.content?.incoming[serverCardIndex.current]
    if (serverCard) {
      serverCardIndex.current += 1
      return serverCard
    }
    return undefined
  }

  function dealRun() {
    runtime.reset('ready')
    answers.current = []
    serverCardIndex.current = 0
    serverAttempts.current = []
    insights.value = null
    failedSlot.value = null
    revealOutcome.value = false
    isPB.value = false
    inserts.value = 0
    cardPhase.value = 'playing'

    row.value = []
    current.value = null
  }

  async function start() {
    if (!(await gameRun.ensureFreshRun())) return
    const challenge = gameRun.content
    if (!challenge) return
    row.value = sortByElixir(challenge.starting)
    current.value = challenge.incoming[0] ?? null
    serverCardIndex.current = current.value ? 1 : 0
    if (!current.value) return
    runtime.startNow((startedAt) => {
      cardStart.current = startedAt
      cardPhase.value = 'playing'
    })
  }

  function nextCard() {
    if (stage.value !== 'running') return
    const card = drawCard()
    if (!card) {
      finish(null)
      return
    }
    current.value = card
    cardPhase.value = 'playing'
    cardStart.current = performance.now()
    preloadImages([card], () => {})
    runtime.emitCue('round-advance', { cardId: card.id })
  }

  function finish(slotIndex: number | null) {
    const card = current.value
    if (card && slotIndex !== null) {
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
      // Live display only; endlessLadderBest is persisted centrally on acceptance.
      best.value = inserts.value
      track('record.new')
    }

    track('endless.complete')
    elixirLine.value = pb
      ? `${inserts.value} inserts. New Endless Ladder best.`
      : slotIndex === null
        ? `${inserts.value} inserts. Signed challenge cleared.`
        : `${inserts.value} inserts. The slot math broke first; rebuild from the anchors.`
    runtime.finish('over')
    void gameRun.complete({ attempts: serverAttempts.current })
  }

  // Rendered slots are group boundaries; the transcript and row math use the
  // full-row index. Equal-cost cards accept either side, so the boundary set
  // loses no legal placement.
  function insert(groupSlot: number, slotIndex: number) {
    if (stage.value !== 'running' || cardPhase.value !== 'playing') return
    const card = current.value
    if (!card) return
    serverAttempts.current.push({ cardId: card.id, slotIndex })

    if (!canInsertAt(row.value, card, slotIndex)) {
      playWrong()
      revealOutcome.value = true
      cardPhase.value = 'wrong'
      runtime.emitCue('answer-wrong', { cardId: card.id })
      later(() => finish(groupSlot), ENDLESS.WRONG_BEAT_MS)
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
    runtime.emitCue('answer-correct', { cardId: card.id })
    later(nextCard, ENDLESS.CORRECT_BEAT_MS)
  }

  function replay() {
    dealRun()
    void gameRun.prepare()
  }

  if (!gameRun.content) {
    return (
      <GameRunGate preparing={gameRun.preparing.value} error={gameRun.error} onRetry={() => void gameRun.prepare()} />
    )
  }

  if (stage.value === 'over' && insights.value) {
    const pbCallout = isPB.value ? 'New personal best!' : best.value > 0 ? `Best: ${best.value}` : undefined
    const failed = failedSlot.value === null ? null : current.value

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
            disabled={!gameRun.assetsReady || gameRun.preparing.value}
          >
            {gameRun.assetsReady ? 'Start Endless Ladder' : 'Loading cards…'}
          </button>
          <button class="btn btn--ghost btn--sm" onClick={() => navigate('/')}>
            Back
          </button>
        </div>
      </div>
    )
  }

  const card = current.value

  // Collapse consecutive same-cost cards into stacks: the late game stays
  // about "where does this cost belong", not scanning a scrolling row.
  const rowGroups: Array<{ card: Card; count: number }> = []
  for (const rowCard of row.value) {
    const last = rowGroups.at(-1)
    if (last && last.card.elixir === rowCard.elixir) last.count += 1
    else rowGroups.push({ card: rowCard, count: 1 })
  }
  const fullSlotIndex = (groupSlot: number) =>
    rowGroups.slice(0, groupSlot).reduce((sum, group) => sum + group.count, 0)
  const slotWouldWork = (groupSlot: number) => Boolean(card && canInsertAt(row.value, card, fullSlotIndex(groupSlot)))
  const slotClass = (groupSlot: number) => {
    const classes = ['endless-slot']
    if (failedSlot.value === groupSlot) classes.push('endless-slot--wrong')
    if (revealOutcome.value && slotWouldWork(groupSlot)) classes.push('endless-slot--correct')
    return classes.join(' ')
  }

  return (
    <div class="main-content game-run endless" style={{ alignItems: 'center', gap: 18 }}>
      <GameFxLayer cue={runtime.cue.value} particleCount={8} />
      <div class="surge-hud ladder-hud">
        <div class="surge-hud__timer" aria-label="successful inserts">
          {inserts.value}
        </div>
        <div class="surge-hud__count">inserts · best {best.value}</div>
      </div>

      {card && (
        <GameMotion contentKey={card.id} cue={runtime.cue.value}>
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
        </GameMotion>
      )}

      <div class="ladder-rail endless-rail" aria-hidden="true">
        <span>low</span>
        <span>high</span>
      </div>

      <div class="endless-track" aria-label="Endless Ladder insertion slots">
        <button
          type="button"
          class={slotClass(0)}
          onClick={() => insert(0, 0)}
          disabled={cardPhase.value !== 'playing'}
          data-testid="endless-slot"
          data-slot-index={0}
        >
          Insert before
        </button>
        {rowGroups.map((group, index) => (
          <div class="endless-step" key={`${group.card.id}-${group.count}`}>
            <div class={`endless-stack${group.count > 1 ? ' endless-stack--multi' : ''}`}>
              <EndlessRowCard card={group.card} revealCost={stage.value === 'over' || revealOutcome.value} />
              {group.count > 1 && (
                <span class="endless-stack__count" aria-label={`${group.count} cards of this cost`}>
                  ×{group.count}
                </span>
              )}
            </div>
            <button
              type="button"
              class={slotClass(index + 1)}
              onClick={() => insert(index + 1, fullSlotIndex(index + 1))}
              disabled={cardPhase.value !== 'playing'}
              data-testid="endless-slot"
              data-slot-index={index + 1}
            >
              {index === rowGroups.length - 1 ? 'Insert after' : 'Insert here'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
