// Shared Home presentation bits used by both HomeMobile and HomeDesktop: the
// rotating promotion hero, ambient elixir motes, and the "More games" card.

import { useEffect, useRef, useState } from 'preact/hooks'
import Icon from '../../components/Icon'
import ModeIcon from '../../components/ModeIcon'
import { navigate } from '../../lib/router'
import { tapFxFrom } from '../../lib/tap-fx'
import { scoreLabel } from '../../lib/game-metadata'
import { canPlayOffline, offline } from '../../lib/api-availability'
import { isReducedMotionEnabled } from '../../lib/motion'
import { shareDrop } from '../../lib/share-run'
import { track } from '../../lib/analytics'
import type { HomeGame } from './home-games'
import { seasonEndsLabel, type HomeData } from './home-data'

const HERO_SLIDE_COUNT = 3
const HERO_ROTATION_MS = 10_000
const FREE_PASS_MODE = 'surge' as const

// Falling elixir motes inside a card (CSS-animated, decorative).
export function GameMotes({ dense = false }: { dense?: boolean }) {
  return (
    <span class="ed-fx" aria-hidden="true">
      <span class="ed-cell-drop" style={{ left: '66%' }} />
      <span class="ed-cell-drop" style={{ left: '26%', animationDelay: '1.4s' }} />
      {dense && <span class="ed-cell-drop" style={{ left: '80%', animationDelay: '2.1s' }} />}
      {!dense && <span class="ed-cell-sheen" style={{ animationDelay: '0.3s' }} />}
    </span>
  )
}

function personalBestText(game: HomeGame, best: number | undefined): string {
  if (best === undefined) return 'Your best · —'
  return `Your best · ${scoreLabel(game.mode, best)}`
}

// `withHours` gives the desktop pill its "6d 04h" form.
export function FeaturedHero({
  data,
  game,
  withHours = false
}: {
  data: HomeData
  game: HomeGame
  withHours?: boolean
}) {
  const offlinePlay = offline.value && canPlayOffline(game.mode)
  const offlineDescriptionId = `featured-${game.mode}-offline-description`
  const best = data.bestScores[game.mode]
  const bestText = best === undefined ? '—' : scoreLabel(game.mode, best)
  const rank = data.rankFor(game.mode)
  const rankText = !offline.value && rank ? `#${rank}` : '—'
  return (
    <section class="ed-hero">
      <span class="ed-fx" aria-hidden="true">
        <span class="ed-cell-drop" style={{ left: '82%' }} />
        <span class="ed-cell-drop" style={{ left: '90%', animationDelay: '1.6s' }} />
        <span class="ed-cell-drop" style={{ left: '70%', animationDelay: '2.6s' }} />
      </span>
      <span class="ed-drop-shape ed-hero__blob ed-hero__blob--a" aria-hidden="true" />
      <span class="ed-drop-shape ed-hero__blob ed-hero__blob--b" aria-hidden="true" />
      <div class="ed-hero__body">
        <span class="ed-pill ed-pill--gold">{seasonEndsLabel(data.season, withHours)}</span>
        <ModeIcon mode={game.mode} size={60} className="ed-hero__art" />
        {/* Long names get their own size step rather than wrapping the
            wordmark, which reads as a broken headline. */}
        <div class={`ed-hero__wordmark${game.name.length > 8 ? ' ed-hero__wordmark--long' : ''}`}>
          {game.name.toLocaleUpperCase()}
        </div>
        <p class="ed-hero__desc">{game.desc}</p>
        <div class="ed-hero__cta">
          <button
            class="ed-btn ed-btn--gold ed-btn--lg tap-fx"
            aria-describedby={offlinePlay ? offlineDescriptionId : undefined}
            onClick={(e) => {
              tapFxFrom(e)
              navigate(game.path)
            }}
          >
            <span class="tap-face">
              <Icon name="play" /> {offlinePlay ? 'PLAY OFFLINE' : 'PLAY'}
            </span>
            {offlinePlay && (
              <span id={offlineDescriptionId} class="sr-only">
                {game.name} is available offline. This run will not be saved or ranked.
              </span>
            )}
          </button>
          <div class="ed-hero__best">
            <span class="ed-hero__best-label">Best · Rank</span>
            <strong class="ed-hero__best-val">
              {bestText} · {rankText}
            </strong>
          </div>
        </div>
      </div>
    </section>
  )
}

function FreePassHero({ data, withHours }: { data: HomeData; withHours: boolean }) {
  return (
    <section class="ed-hero ed-hero--pass">
      <span class="ed-drop-shape ed-hero__blob ed-hero__blob--a" aria-hidden="true" />
      <span class="ed-drop-shape ed-hero__blob ed-hero__blob--b" aria-hidden="true" />
      <div class="ed-hero__body">
        <span class="ed-pill ed-pill--gold">Free Pass · {seasonEndsLabel(data.season, withHours)}</span>
        <ModeIcon mode={FREE_PASS_MODE} size={60} className="ed-hero__art" />
        <div class="ed-hero__wordmark ed-hero__wordmark--pass">WIN A PASS</div>
        <p class="ed-hero__desc">Finish #1 in Surge when the Clan Wars season ends and win a gifted Pass Royale.</p>
        <div class="ed-hero__cta ed-hero__cta--split">
          <button
            class="ed-btn ed-btn--gold ed-btn--lg tap-fx"
            onClick={(event) => {
              tapFxFrom(event)
              track('campaign.opened', FREE_PASS_MODE)
              navigate('/surge')
            }}
          >
            <span class="tap-face">
              <Icon name="play" /> PLAY SURGE
            </span>
          </button>
          <a
            class="ed-btn ed-btn--ghost ed-btn--lg"
            href="https://poapkings.com/elixir-drop/free-pass/"
            data-tinylytics-event="campaign.rules_opened"
          >
            RULES
          </a>
        </div>
      </div>
    </section>
  )
}

function ShareHero() {
  const [status, setStatus] = useState<'idle' | 'sharing' | 'shared' | 'copied' | 'unavailable'>('idle')

  const share = async () => {
    setStatus('sharing')
    const outcome = await shareDrop()
    if (outcome === 'shared' || outcome === 'copied') {
      track('home.shared')
      setStatus(outcome)
      return
    }
    setStatus(outcome === 'cancelled' ? 'idle' : 'unavailable')
  }

  const label =
    status === 'sharing'
      ? 'SHARING…'
      : status === 'shared'
        ? 'SHARED'
        : status === 'copied'
          ? 'LINK COPIED'
          : status === 'unavailable'
            ? 'COPY UNAVAILABLE'
            : 'SHARE ELIXIR DROP'

  return (
    <section class="ed-hero ed-hero--share">
      <span class="ed-drop-shape ed-hero__blob ed-hero__blob--a" aria-hidden="true" />
      <span class="ed-drop-shape ed-hero__blob ed-hero__blob--b" aria-hidden="true" />
      <div class="ed-hero__body">
        <span class="ed-pill ed-pill--gold">Pass it on</span>
        <Icon name="share" className="ed-hero__feature-icon" />
        <div class="ed-hero__wordmark ed-hero__wordmark--share">BRING A FRIEND</div>
        <p class="ed-hero__desc">
          Know someone who still has to count elixir costs? Send them Drop and race the same board.
        </p>
        <div class="ed-hero__cta">
          <button
            class="ed-btn ed-btn--gold ed-btn--lg tap-fx"
            disabled={status === 'sharing'}
            onClick={(event) => {
              tapFxFrom(event)
              void share()
            }}
          >
            <span class="tap-face">
              <Icon name="share" /> {label}
            </span>
          </button>
        </div>
      </div>
    </section>
  )
}

export function HomeHeroCarousel({
  data,
  game,
  withHours = false
}: {
  data: HomeData
  game: HomeGame
  withHours?: boolean
}) {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const reduceMotion = isReducedMotionEnabled()
  const swipeStart = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const swiped = useRef(false)

  useEffect(() => {
    if (paused || reduceMotion) return
    const timer = window.setTimeout(() => setActive((current) => (current + 1) % HERO_SLIDE_COUNT), HERO_ROTATION_MS)
    return () => window.clearTimeout(timer)
  }, [active, paused, reduceMotion])

  const select = (index: number) => setActive((index + HERO_SLIDE_COUNT) % HERO_SLIDE_COUNT)

  const finishSwipe = (event: PointerEvent) => {
    const start = swipeStart.current
    if (!start || start.pointerId !== event.pointerId) return
    swipeStart.current = null

    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return

    swiped.current = true
    event.preventDefault()
    select(active + (deltaX < 0 ? 1 : -1))
    window.setTimeout(() => {
      swiped.current = false
    }, 0)
  }

  return (
    <div
      class="ed-hero-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured Elixir Drop promotions"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false)
      }}
    >
      <div
        class="ed-hero-carousel__slide"
        aria-live="off"
        onPointerDown={(event) => {
          if (event.button !== 0 || event.isPrimary === false) return
          swipeStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
          swiped.current = false
        }}
        onPointerUp={finishSwipe}
        onPointerCancel={() => {
          swipeStart.current = null
          swiped.current = false
        }}
        onClickCapture={(event) => {
          if (!swiped.current) return
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        {active === 0 && <FeaturedHero data={data} game={game} withHours={withHours} />}
        {active === 1 && <FreePassHero data={data} withHours={withHours} />}
        {active === 2 && <ShareHero />}
      </div>
      <div class="ed-hero-carousel__controls" aria-label="Choose a hero slide">
        <button type="button" aria-label="Previous slide" onClick={() => select(active - 1)}>
          <Icon name="chevron-left" />
        </button>
        <div class="ed-hero-carousel__dots">
          {['Featured game', 'Free Pass challenge', 'Share Elixir Drop'].map((label, index) => (
            <button
              type="button"
              class={index === active ? 'is-active' : undefined}
              aria-label={label}
              aria-current={index === active ? 'true' : undefined}
              onClick={() => select(index)}
              key={label}
            />
          ))}
        </div>
        <button type="button" aria-label="Next slide" onClick={() => select(active + 1)}>
          <Icon name="chevron-right" />
        </button>
      </div>
    </div>
  )
}

export function HomeGameCard({
  game,
  featured,
  best
}: {
  game: HomeGame
  featured: boolean
  best: number | undefined
}) {
  const offlinePlay = offline.value && canPlayOffline(game.mode)
  const offlineDescriptionId = `${game.mode}-offline-description`
  return (
    <article class={`ed-gcard${featured ? ' ed-gcard--accent' : ''}`}>
      <GameMotes dense={featured} />
      <div class="ed-gcard__body">
        <div class="ed-gcard__title">
          <ModeIcon mode={game.mode} size={50} className="ed-gcard__art" />
          {game.name}
          {game.badge && <span class="ed-gcard__badge">{game.badge}</span>}
        </div>
        <p class="ed-gcard__desc">{game.desc}</p>
        <div class="ed-gcard__champ">
          <Icon name="trophy" />
          <span>{personalBestText(game, best)}</span>
        </div>
        <button
          class="ed-btn ed-btn--gold ed-btn--sm tap-fx"
          aria-describedby={offlinePlay ? offlineDescriptionId : undefined}
          onClick={(e) => {
            tapFxFrom(e)
            navigate(game.path)
          }}
        >
          <span class="tap-face">
            <Icon name="play" /> {offlinePlay ? 'Play offline' : 'Play'}
          </span>
          {offlinePlay && (
            <span id={offlineDescriptionId} class="sr-only">
              {game.name} is available offline. This run will not be saved or ranked.
            </span>
          )}
        </button>
      </div>
    </article>
  )
}
