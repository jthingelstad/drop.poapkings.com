import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card, InputStyle } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import type { GameRuntimeCue } from '../../lib/game-runtime'
import { pointerVerb } from '../../lib/use-layout'
import { makeChoices } from '../../lib/choices'
import { pickPracticeCard } from '../../lib/practice-deal'
import {
  queuedPracticeCardIds,
  resolvePracticeReview,
  type PracticeReviewItem,
  type PracticeReviewStage
} from '../../lib/practice-review'
import { saveResult, getCardStats, getSettings, saveSettings, recordSession } from '../../lib/storage'
import { computeInsights } from '../../lib/insights'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import CardDisplay from '../../components/CardDisplay'
import PipKeypad from '../../components/PipKeypad'
import MultipleChoice from '../../components/MultipleChoice'
import FloatingCue from '../../components/FloatingCue'
import Icon from '../../components/Icon'
import Summary from '../../components/Summary'
import DrillPanel from '../../components/summary/DrillPanel'
import PracticeStats from '../../components/summary/PracticeStats'
import { costRecallSignature } from '../../lib/signatures'
import GameRunGate from '../../components/GameRunGate'
import GameMotion from '../../components/GameMotion'
import GameFrame from '../../components/game/GameFrame'
import GameStartScreen from '../../components/game/GameStart'
import { preloadGameFx } from '../../components/GameFxLayer'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'
import { useGameRuntime } from '../../lib/use-game-runtime'
import { track } from '../../lib/analytics'
import { preloadImages } from '../../lib/preload'

const CORRECT_HOLD_MS = 300
const REVEALED_ANSWER_HOLD_MS = 1_600
const WRONG_BEAT_MS = 430
const IDLE_HINT_MS = 7_000
const MAX_RESPONSE_MS = 60_000

interface Props {
  eyebrow: string
  onExit?: () => void
}

// A card on the table plus the choice window and, when applicable, the spaced
// review that deliberately brought it back.
interface Hand {
  card: Card
  choices: number[]
  reviewStage?: PracticeReviewStage
}

interface PendingExit {
  generation: number
  next: Hand
  holdReady: boolean
  artReady: boolean
  exiting: boolean
}

function handFor(card: Card, reviewStage?: PracticeReviewStage): Hand {
  return {
    card,
    choices: makeChoices(card.elixir),
    ...(reviewStage ? { reviewStage } : {})
  }
}

// A due review wins the next deal. Cards waiting in the review queue are kept
// out of the weighted pool so random chance cannot collapse their spacing.
function draw(
  deck: readonly Card[],
  previousId: number | undefined,
  queue: readonly PracticeReviewItem[],
  answered: number
): Hand | null {
  const due = queue.find(
    (item) =>
      item.dueAtAnswered <= answered && item.cardId !== previousId && deck.some((card) => card.id === item.cardId)
  )
  if (due) {
    const card = deck.find((candidate) => candidate.id === due.cardId)
    if (card) return handFor(card, due.stage)
  }

  const queued = queuedPracticeCardIds(queue)
  const unqueued = deck.filter((card) => !queued.has(card.id))
  const pool = unqueued.length > 0 ? unqueued : deck
  const next = pickPracticeCard(pool, getCardStats(), previousId)
  return next ? handFor(next) : null
}

function narrowedChoices(choices: readonly number[], answer: number): number[] {
  const nearestWrong = choices
    .filter((choice) => choice !== answer)
    .sort((left, right) => Math.abs(left - answer) - Math.abs(right - answer))[0]
  return nearestWrong === undefined
    ? [answer]
    : choices.filter((choice) => choice === answer || choice === nearestWrong)
}

// Practice: a fast learning loop, not a score chase. First-read recall is timed
// invisibly; assisted recognition is tracked separately; misses are guaranteed
// to return after a retrieval gap; and the correct value remains attached to the
// card through its art-ready exit animation.
export default function PracticeLoop({ eyebrow, onExit }: Props) {
  const gameRun = useGameSession('practice', challengePreparers.practice)
  const runtime = useGameRuntime({ initialStage: 'running', guardActiveRun: false, trackElapsed: false })
  const exit = onExit ?? (() => navigate('/'))
  const answers = useRef<Answer[]>([])
  const serverAnswers = useRef<Array<{ cardId: number; guess: number; responseMs: number; assisted: boolean }>>([])
  const recorded = useRef(false)
  const wrongAttempts = useRef(0)
  const reviewQueue = useRef<PracticeReviewItem[]>([])
  const promptStartedAt = useRef(0)
  const promptPausedAt = useRef<number | null>(null)
  const promptPausedMs = useRef(0)
  const assistUsed = useRef(false)
  const recognitionExposed = useRef(false)
  const idleHintGeneration = useRef(0)
  const handoffGeneration = useRef(0)
  const pendingExit = useRef<PendingExit | null>(null)
  const currentHand = useRef<Hand | null>(null)
  const openingCache = useRef<{
    deck: readonly Card[] | null | undefined
    generation: number
    hand: Hand | null
  }>()
  const deck = gameRun.content

  const settings = getSettings()
  const inputStyle = useSignal<InputStyle>(settings.inputStyle)
  const dealt = useSignal<Hand | null>(null)
  const openingGeneration = useSignal(0)
  const openingReadyId = useSignal<number | null>(null)
  const answered = useSignal(0)
  const phase = useSignal<'playing' | 'correct' | 'wrong'>('playing')
  const hint = useSignal<'higher' | 'lower' | null>(null)
  const hintGuess = useSignal<number | null>(null)
  const hintPulse = useSignal(0)
  const idleHintAvailable = useSignal(false)
  const temporaryChoices = useSignal(false)
  const choicesNarrowed = useSignal(false)
  const selectedChoice = useSignal<number | null>(null)
  const revealCorrectChoice = useSignal(false)
  const revealedAnswer = useSignal(false)
  const achievementCue = useSignal(0)
  const achievementText = useSignal('')
  const reinforcedCost = useSignal<number | null>(null)
  const correct = useSignal(0)
  const recovered = useSignal(0)
  const insights = useSignal<Insights | null>(null)

  useEffect(() => {
    preloadGameFx()
    const onVisibilityChange = () => {
      const now = performance.now()
      if (document.visibilityState === 'hidden') {
        promptPausedAt.current = now
        idleHintAvailable.value = false
        idleHintGeneration.current += 1
        return
      }
      if (promptPausedAt.current !== null) {
        promptPausedMs.current += now - promptPausedAt.current
        promptPausedAt.current = null
      }
      const active = currentHand.current
      if (active && phase.peek() === 'playing') armIdleHint(active.card.id)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      idleHintGeneration.current += 1
      handoffGeneration.current += 1
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-only listener reads current refs and signals

  // The opening hand is derived so no empty frame can render between challenge
  // resolution and the first card. A seeded "Review misses" queue may own it.
  const openingGenerationValue = openingGeneration.value
  if (
    !openingCache.current ||
    openingCache.current.deck !== deck ||
    openingCache.current.generation !== openingGenerationValue
  ) {
    openingCache.current = {
      deck,
      generation: openingGenerationValue,
      hand: draw(deck ?? [], undefined, reviewQueue.current, answered.peek())
    }
  }
  const opening = openingCache.current.hand
  const hand = dealt.value ?? opening
  currentHand.current = hand

  const openingCard = opening?.card
  const openingCardId = openingCard?.id
  const handReady = Boolean(
    hand && gameRun.assetsReady && (dealt.value !== null || openingReadyId.value === openingCardId)
  )
  useEffect(() => {
    if (!openingCard) return
    let active = true
    preloadImages([openingCard], () => {
      if (active) openingReadyId.value = openingCard.id
    })
    return () => {
      active = false
    }
  }, [openingCard, openingGenerationValue, openingReadyId])

  // Start the invisible response clock only after the hand exists in the DOM.
  // Background time is subtracted by the visibility handler above.
  useEffect(() => {
    if (!hand || !handReady || runtime.stage.peek() !== 'running') return
    promptStartedAt.current = performance.now()
    promptPausedAt.current = document.visibilityState === 'hidden' ? promptStartedAt.current : null
    promptPausedMs.current = 0
    assistUsed.current = false
    recognitionExposed.current = inputStyle.peek() === 'choice'
    wrongAttempts.current = 0
    armIdleHint(hand.card.id)
  }, [hand?.card.id, handReady]) // eslint-disable-line react-hooks/exhaustive-deps -- card identity owns the prompt clock

  function armIdleHint(cardId: number): void {
    const generation = ++idleHintGeneration.current
    idleHintAvailable.value = false
    runtime.later(() => {
      if (generation !== idleHintGeneration.current || document.visibilityState !== 'visible') return
      if (runtime.stage.peek() !== 'running' || phase.peek() !== 'playing') return
      if (currentHand.current?.card.id !== cardId || assistUsed.current) return
      idleHintAvailable.value = true
    }, IDLE_HINT_MS)
  }

  function responseMs(): number {
    const pausedNow = promptPausedAt.current === null ? 0 : performance.now() - promptPausedAt.current
    return Math.round(
      Math.max(
        0,
        Math.min(MAX_RESPONSE_MS, performance.now() - promptStartedAt.current - promptPausedMs.current - pausedNow)
      )
    )
  }

  function showHand(next: Hand): void {
    dealt.value = next
    recorded.current = false
    wrongAttempts.current = 0
    phase.value = 'playing'
    hint.value = null
    hintGuess.value = null
    reinforcedCost.value = null
    revealedAnswer.value = false
    selectedChoice.value = null
    revealCorrectChoice.value = false
    temporaryChoices.value = false
    choicesNarrowed.value = false
    idleHintAvailable.value = false
    recognitionExposed.current = inputStyle.peek() === 'choice'
    idleHintGeneration.current += 1
  }

  function celebrate(text: string): void {
    achievementText.value = text
    achievementCue.value++
  }

  function scheduleMissedCard(current: Hand, firstReadCorrect: boolean, assisted: boolean): void {
    const outcome = resolvePracticeReview(
      reviewQueue.current,
      current.card.id,
      answered.peek(),
      current.reviewStage,
      firstReadCorrect,
      assisted
    )
    reviewQueue.current = outcome.queue
    if (outcome.recovered) {
      recovered.value++
      celebrate('Got it back!')
    } else if (outcome.locked) {
      celebrate('Locked in!')
    }
  }

  function tryStartExit(): void {
    const pending = pendingExit.current
    if (!pending || pending.exiting || !pending.holdReady || !pending.artReady) return
    if (pending.generation !== handoffGeneration.current || runtime.stage.peek() !== 'running') return
    pending.exiting = true
    runtime.emitCue('practice-exit', { cardId: currentHand.current?.card.id })
  }

  function prepareExit(current: Card, holdMs: number): void {
    const next = draw(deck ?? [], current.id, reviewQueue.current, answered.peek())
    if (!next) return
    const generation = ++handoffGeneration.current
    pendingExit.current = { generation, next, holdReady: false, artReady: false, exiting: false }
    preloadImages([next.card], () => {
      const pending = pendingExit.current
      if (!pending || pending.generation !== generation) return
      pending.artReady = true
      tryStartExit()
    })
    runtime.later(() => {
      const pending = pendingExit.current
      if (!pending || pending.generation !== generation) return
      pending.holdReady = true
      tryStartExit()
    }, holdMs)
  }

  function handleMotionComplete(cue: GameRuntimeCue): void {
    if (cue.type !== 'practice-exit') return
    const pending = pendingExit.current
    if (!pending || pending.generation !== handoffGeneration.current) return
    pendingExit.current = null
    showHand(pending.next)
    runtime.emitCue('round-advance', { cardId: pending.next.card.id })
  }

  function endSession() {
    idleHintGeneration.current += 1
    handoffGeneration.current += 1
    pendingExit.current = null
    const list = answers.current
    if (list.length === 0) {
      exit()
      return
    }
    insights.value = computeInsights(list)
    recordSession()
    // Online sessions persist validated recall, response time, and assistance.
    // Offline completion is swallowed by use-game-run; the same local learning
    // signals still drive this device and nothing is queued for reconnect.
    void gameRun.complete({ answers: serverAnswers.current })
    runtime.finish()
  }

  function recordFirstRead(current: Hand, picked: number, isCorrect: boolean, assisted: boolean): void {
    const elapsed = responseMs()
    recorded.current = true
    // Only unassisted keypad latency contributes to fluent-recall averages.
    saveResult(current.card.id, isCorrect, assisted ? undefined : elapsed, assisted)
    answers.current.push({
      card: current.card,
      guess: picked,
      correct: isCorrect,
      // Assisted recognition keeps its bounded response time in the server
      // transcript, but it must not drive local fluent-recall coaching.
      ...(assisted ? {} : { ms: elapsed }),
      assisted,
      ...(current.reviewStage ? { reviewStage: current.reviewStage } : {})
    })
    serverAnswers.current.push({ cardId: current.card.id, guess: picked, responseMs: elapsed, assisted })
    answered.value++
    scheduleMissedCard(current, isCorrect, assisted)

    if (isCorrect) {
      correct.value++
    }
  }

  function revealAnswer(current: Hand): void {
    hint.value = null
    hintGuess.value = null
    reinforcedCost.value = current.card.elixir
    revealedAnswer.value = true
    revealCorrectChoice.value = true
    prepareExit(current.card, REVEALED_ANSWER_HOLD_MS)
  }

  function handleAnswer(picked: number) {
    if (runtime.stage.peek() !== 'running' || phase.peek() !== 'playing') return
    const current = currentHand.current
    if (!current) return

    idleHintGeneration.current += 1
    idleHintAvailable.value = false
    selectedChoice.value = picked
    const choiceInput = inputStyle.peek() === 'choice' || temporaryChoices.peek()
    // Once choices have been visible for this card, switching back to the
    // keypad cannot turn recognition into an unassisted recall sample.
    const assisted = choiceInput || assistUsed.current || recognitionExposed.current
    const isCorrect = picked === current.card.elixir
    const firstRead = !recorded.current
    if (firstRead) recordFirstRead(current, picked, isCorrect, assisted)

    if (isCorrect) {
      playCorrect()
      phase.value = 'correct'
      hint.value = null
      hintGuess.value = null
      reinforcedCost.value = current.card.elixir
      revealedAnswer.value = false
      revealCorrectChoice.value = true
      runtime.emitCue('answer-correct', { cardId: current.card.id })
      prepareExit(current.card, CORRECT_HOLD_MS)
      return
    }

    wrongAttempts.current += 1
    playWrong()
    phase.value = 'wrong'
    runtime.emitCue('answer-wrong', { cardId: current.card.id })

    // Recognition choices are already a scaffold; another attempt mostly trains
    // elimination. Keypad recall keeps one playful directional retry, anchored
    // to the value the player actually chose.
    const shouldReveal = choiceInput || wrongAttempts.current >= 2
    if (shouldReveal) {
      runtime.later(() => {
        if (currentHand.current?.card.id === current.card.id && runtime.stage.peek() === 'running')
          revealAnswer(current)
      }, WRONG_BEAT_MS)
      return
    }

    hint.value = picked < current.card.elixir ? 'higher' : 'lower'
    hintGuess.value = picked
    hintPulse.value++
    runtime.later(() => {
      if (currentHand.current?.card.id !== current.card.id || runtime.stage.peek() !== 'running') return
      phase.value = 'playing'
      armIdleHint(current.card.id)
    }, WRONG_BEAT_MS)
  }

  function replay(reviewCards: Card[] = []) {
    track('game.replayed', 'practice')
    runtime.reset('running')
    answers.current = []
    serverAnswers.current = []
    reviewQueue.current = reviewCards.map((card, index) => ({
      cardId: card.id,
      dueAtAnswered: index,
      stage: 'retry'
    }))
    answered.value = 0
    correct.value = 0
    recovered.value = 0
    achievementText.value = ''
    reinforcedCost.value = null
    revealedAnswer.value = false
    insights.value = null
    recorded.current = false
    phase.value = 'playing'
    hint.value = null
    hintGuess.value = null
    temporaryChoices.value = false
    choicesNarrowed.value = false
    selectedChoice.value = null
    revealCorrectChoice.value = false
    idleHintAvailable.value = false
    idleHintGeneration.current += 1
    handoffGeneration.current += 1
    pendingExit.current = null
    dealt.value = null
    openingReadyId.value = null
    openingGeneration.value++
    void gameRun.prepare()
  }

  function switchInput(style: InputStyle) {
    inputStyle.value = style
    if (style === 'choice') recognitionExposed.current = true
    temporaryChoices.value = false
    choicesNarrowed.value = false
    idleHintAvailable.value = false
    idleHintGeneration.current += 1
    saveSettings({ inputStyle: style })
    const active = currentHand.current
    if (active && phase.peek() === 'playing' && !assistUsed.current) armIdleHint(active.card.id)
  }

  function useIdleHint() {
    assistUsed.current = true
    recognitionExposed.current = true
    idleHintAvailable.value = false
    idleHintGeneration.current += 1
    if (inputStyle.peek() === 'keypad' && !temporaryChoices.peek()) temporaryChoices.value = true
    else choicesNarrowed.value = true
  }

  if (!deck) return <GameRunGate modeName="Practice" session={gameRun} />

  if (runtime.stage.value === 'summary' && insights.value) {
    const ins = insights.value
    const cardsById = new Map(deck.map((card) => [card.id, card]))
    const reviewCards = reviewQueue.current
      .map((item) => cardsById.get(item.cardId))
      .filter((card): card is Card => card !== undefined)
    const needsReview = reviewCards.length
    const recallAnswers = answers.current.filter((answer) => !answer.assisted)
    const assistedAnswers = answers.current.filter((answer) => answer.assisted)
    // The cards that came back after a gap this session, and whether they held.
    const returns = answers.current
      .filter((answer) => answer.reviewStage)
      .map((answer) => ({ ms: answer.ms ?? 0, correct: answer.correct && !answer.assisted }))
    const signature = costRecallSignature(returns)
    return (
      <div class="ed-gamewrap">
        <Summary
          eyebrow={eyebrow}
          headline={`${ins.total} ${ins.total === 1 ? 'card' : 'cards'} practiced`}
          insights={ins}
          share={{ mode: 'practice', score: '' }}
          onReplay={() => replay(reviewCards)}
          replayLabel={needsReview > 0 ? 'Review misses' : 'Practice again'}
          onHome={exit}
        >
          <PracticeStats
            recall={{
              correct: recallAnswers.filter((answer) => answer.correct).length,
              total: recallAnswers.length
            }}
            assisted={{
              correct: assistedAnswers.filter((answer) => answer.correct).length,
              total: assistedAnswers.length
            }}
            recovered={recovered.value}
            stillDue={needsReview}
          />
          {signature.bars.length > 0 && <DrillPanel {...signature} />}
        </Summary>
      </div>
    )
  }

  if (!gameRun.assetsReady || (dealt.value === null && openingReadyId.value !== openingCardId)) {
    return <GameStartScreen modeName="Practice" phase="loading" />
  }
  if (!hand) return <GameRunGate modeName="Practice" session={gameRun} />
  const current = hand.card
  const choicesVisible = inputStyle.value === 'choice' || temporaryChoices.value
  const visibleChoices = choicesNarrowed.value ? narrowedChoices(hand.choices, current.elixir) : hand.choices
  const controlsDisabled = phase.value !== 'playing' || gameRun.preparing.value

  return (
    <GameFrame
      modeName="Practice"
      counting={false}
      count={0}
      onQuit={endSession}
      quitLabel="End session"
      cue={runtime.cue.value}
      fxParticles={6}
      progressText={`${answered.value} practiced`}
      metric={{ value: String(correct.value), label: 'first try' }}
    >
      <div class="ed-kstage ed-kstage--practice">
        <div class="ed-kstage__card">
          <div class="practice-card-feedback">
            <GameMotion
              contentKey={current.id}
              cue={runtime.cue.value}
              practiceFeedback
              onFeedbackComplete={handleMotionComplete}
            >
              <CardDisplay
                card={current}
                phase={phase.value}
                revealCost={false}
                reinforceCost={reinforcedCost.value !== null}
              />
            </GameMotion>
            <div class="game-cues game-cues--practice" aria-hidden="true">
              <div class="game-cues__slot game-cues__slot--top">
                <FloatingCue trigger={achievementCue.value} className="floating-cue--practice-recovery">
                  {achievementText.value}
                </FloatingCue>
              </div>
              <div class="game-cues__slot game-cues__slot--bottom">
                {hint.value !== null && (
                  <FloatingCue
                    trigger={hintPulse.value}
                    className="floating-cue--hint"
                    testId="practice-hint"
                    persistent
                  >
                    {hint.value === 'higher' ? (
                      <>
                        <Icon name="arrow-up" /> Higher than {hintGuess.value}
                      </>
                    ) : (
                      <>
                        <Icon name="arrow-down" /> Lower than {hintGuess.value}
                      </>
                    )}
                  </FloatingCue>
                )}
              </div>
            </div>
          </div>
        </div>

        <div class="ed-kstage__hint">
          {idleHintAvailable.value ? (
            <button class="practice-idle-assist" onClick={useIdleHint}>
              <Icon name="circle-help" />
              {choicesVisible ? 'Narrow it down' : 'Need a nudge? Show choices'}
            </button>
          ) : (
            <span>{pointerVerb()} the elixir cost</span>
          )}
        </div>
        <div class="input-toggle">
          <button
            class={`input-toggle__btn${!choicesVisible ? ' input-toggle__btn--active' : ''}`}
            onClick={() => switchInput('keypad')}
            aria-pressed={!choicesVisible}
          >
            Keypad
          </button>
          <button
            class={`input-toggle__btn${choicesVisible ? ' input-toggle__btn--active' : ''}`}
            onClick={() => switchInput('choice')}
            aria-pressed={choicesVisible}
          >
            4 choices
          </button>
        </div>

        {choicesVisible ? (
          <MultipleChoice
            choices={visibleChoices}
            onPick={handleAnswer}
            disabled={controlsDisabled}
            selected={selectedChoice.value}
            correct={current.elixir}
            revealCorrect={revealCorrectChoice.value}
          />
        ) : (
          <PipKeypad onPick={handleAnswer} disabled={controlsDisabled} />
        )}

        <span class="sr-only" aria-live="assertive">
          {reinforcedCost.value !== null
            ? revealedAnswer.value
              ? `The answer is ${reinforcedCost.value} elixir.`
              : `Correct. ${reinforcedCost.value} elixir.`
            : phase.value === 'wrong' && hint.value && hintGuess.value !== null
              ? `${hint.value === 'higher' ? 'Higher' : 'Lower'} than ${hintGuess.value}.`
              : ''}
        </span>
        <span class="sr-only" aria-live="polite">
          {idleHintAvailable.value ? 'A hint is available.' : ''}
        </span>
      </div>
    </GameFrame>
  )
}
