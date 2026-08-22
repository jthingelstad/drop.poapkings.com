// Shared Home presentation bits: the rotating promotion hero and the full-width
// game rows. (The retired desktop home's grid card + its ambient motes went with
// it; the hero owns its own decorative motes inline.)

import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import Icon from '../../components/Icon'
import ModeIcon from '../../components/ModeIcon'
import PlayerAvatar from '../../components/PlayerAvatar'
import { player } from '../../lib/account'
import { navigate } from '../../lib/router'
import { tapFxFrom } from '../../lib/tap-fx'
import { scoreLabel } from '../../lib/game-metadata'
import { canPlayOffline, offline } from '../../lib/api-availability'
import { isReducedMotionEnabled } from '../../lib/motion'
import { shareDrop } from '../../lib/share-run'
import { track } from '../../lib/analytics'
import type { HomeGame } from './home-games'
import { seasonEndsLabel, seasonPillLabel, type HomeData } from './home-data'

const HERO_SLIDE_COUNT = 3
const HERO_ROTATION_MS = 10_000
const FREE_PASS_MODE = 'surge' as const

// The season pill names the season and its clock — "Season 135 · 6d 04h" — and
// hours are never dropped, because they are what matters on the last day. The
// Free Pass slide keeps the sentence form: its pill already leads with "Free
// Pass", so the season cannot also lead there.
export function FeaturedHero({ data, game }: { data: HomeData; game: HomeGame }) {
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
      <div class="ed-hero__body">
        <span class="ed-pill ed-pill--season">{seasonPillLabel(data.season)}</span>
        {/* 72 against the rows' 46. The hero's whole claim is that one game is
            bigger than the rows, and 60 was too thin a margin to make it. */}
        <ModeIcon mode={game.mode} size={72} className="ed-hero__art" />
        {/* Long names get their own size step rather than wrapping the
            wordmark, which reads as a broken headline. */}
        <div class={`ed-hero__wordmark${game.name.length > 8 ? ' ed-hero__wordmark--long' : ''}`}>
          {game.name.toLocaleUpperCase()}
        </div>
        <p class="ed-hero__desc">{game.desc}</p>
        {/* Every game-start action uses the same icon + PLAY language. The mode
            name already sits immediately above it and never belongs in the CTA. */}
        <button
          class="ed-btn ed-btn--gold ed-hero__play tap-fx"
          aria-describedby={offlinePlay ? offlineDescriptionId : undefined}
          onClick={(e) => {
            tapFxFrom(e)
            navigate(game.path)
          }}
        >
          <span class="tap-face">
            <Icon name="play" /> PLAY
          </span>
        </button>
        {offlinePlay && (
          <span id={offlineDescriptionId} class="sr-only">
            {game.name} is available offline. This run will not be saved or ranked.
          </span>
        )}
        {/* Under the button, not beside it — the result is what the button did
            last time, so it reads as a footnote to the action, not a rival. */}
        <div class="ed-hero__result">
          <span class="ed-hero__result-item">
            Your best <strong>{bestText}</strong>
          </span>
          <span class="ed-hero__result-div" aria-hidden="true" />
          <span class="ed-hero__result-item">
            Rank <strong>{rankText}</strong>
          </span>
        </div>
      </div>
    </section>
  )
}

function FreePassHero({ data }: { data: HomeData }) {
  return (
    <section class="ed-hero ed-hero--pass">
      <div class="ed-hero__body">
        <span class="ed-pill ed-pill--season">Free Pass · {seasonEndsLabel(data.season)}</span>
        <ModeIcon mode={FREE_PASS_MODE} size={72} className="ed-hero__art" />
        <div class="ed-hero__wordmark ed-hero__wordmark--pass">WIN A PASS</div>
        <p class="ed-hero__desc">Finish #1 in Surge when the Clan Wars season ends and win a gifted Pass Royale.</p>
        {/* Two controls share this row, so the primary keeps the standard large
            size rather than the featured hero's full-width one. */}
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
              <Icon name="play" /> PLAY
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
      <div class="ed-hero__body">
        <span class="ed-pill ed-pill--season">Pass it on</span>
        <Icon name="share" className="ed-hero__feature-icon" />
        <div class="ed-hero__wordmark ed-hero__wordmark--share">BRING A FRIEND</div>
        <p class="ed-hero__desc">
          Know someone who still has to count elixir costs? Send them Drop and race the same board.
        </p>
        <div class="ed-hero__cta">
          <button
            class="ed-btn ed-btn--gold ed-hero__play tap-fx"
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

export function HomeHeroCarousel({ data, game }: { data: HomeData; game: HomeGame }) {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const reduceMotion = isReducedMotionEnabled()
  const trackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (paused || reduceMotion) return
    const timer = window.setTimeout(() => {
      const next = (active + 1) % HERO_SLIDE_COUNT
      const track = trackRef.current
      if (track) track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' })
      else setActive(next)
    }, HERO_ROTATION_MS)
    return () => window.clearTimeout(timer)
  }, [active, paused, reduceMotion])

  const select = (index: number) => {
    const next = (index + HERO_SLIDE_COUNT) % HERO_SLIDE_COUNT
    const track = trackRef.current
    if (track) track.scrollTo({ left: next * track.clientWidth, behavior: reduceMotion ? 'auto' : 'smooth' })
    else setActive(next)
  }

  const me = player.value

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
      <span class="ed-hero-carousel__glow" aria-hidden="true" />

      {/* The app says its own name once, at the top of the screen, and the
          player's XP and face sit opposite it — the one place identity appears
          on Play. It is a shortcut to You, not a second profile surface. The
          Guest shortcut occupies that same right-side slot while signed out. */}
      <div class="ed-hero-carousel__topbar">
        <span class="ed-hero-carousel__brand">ELIXIR DROP</span>
        {me && (
          <button
            type="button"
            class="ed-hero-carousel__me"
            aria-label={`${me.publicName} — ${me.xp.toLocaleString()} XP — open You`}
            onClick={() => navigate('/profile')}
          >
            <span class="ed-hero-carousel__xp" aria-hidden="true">
              {me.xp.toLocaleString()} XP
            </span>
            <PlayerAvatar favoriteCardId={me.favoriteCardId} size="small" />
          </button>
        )}
      </div>
      {/* The horizontally scrolling track is itself reachable by keyboard. */}
      <div
        class="ed-hero-carousel__track"
        ref={trackRef}
        aria-live="off"
        tabIndex={0}
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerCancel={() => setPaused(false)}
        onScroll={(event) => {
          const track = event.currentTarget
          if (track.clientWidth === 0) return
          const next = Math.round(track.scrollLeft / track.clientWidth)
          if (next >= 0 && next < HERO_SLIDE_COUNT) setActive(next)
        }}
      >
        <div
          class="ed-hero-carousel__slide"
          role="group"
          aria-roledescription="slide"
          aria-label="1 of 3"
          aria-hidden={active !== 0}
          inert={active !== 0}
        >
          <FeaturedHero data={data} game={game} />
        </div>
        <div
          class="ed-hero-carousel__slide"
          role="group"
          aria-roledescription="slide"
          aria-label="2 of 3"
          aria-hidden={active !== 1}
          inert={active !== 1}
        >
          <FreePassHero data={data} />
        </div>
        <div
          class="ed-hero-carousel__slide"
          role="group"
          aria-roledescription="slide"
          aria-label="3 of 3"
          aria-hidden={active !== 2}
          inert={active !== 2}
        >
          <ShareHero />
        </div>
      </div>
      {/* Dots only. The chevrons existed to frame a bordered card; the panel is
          full-bleed now, and the track already swipes. */}
      <div class="ed-hero-carousel__dots" aria-label="Choose a hero slide">
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
    </div>
  )
}

// A full-width Home row: art | name + meta | PLAY pill. The whole row remains the
// button so its generous tap target is unchanged. Ranked actions are gold;
// Practice is the one purple exception.
export function HomeRow({
  visual,
  name,
  meta,
  tone,
  onClick
}: {
  visual: ComponentChildren
  name: string
  meta: string
  tone: 'ranked' | 'drill'
  onClick: () => void
}) {
  return (
    <button
      class={`ed-grow ed-grow--${tone} tap-fx`}
      onClick={(event) => {
        tapFxFrom(event)
        onClick()
      }}
    >
      <span class="ed-grow__art">{visual}</span>
      <span class="ed-grow__body">
        <strong class="ed-grow__name">{name}</strong>
        <span class="ed-grow__meta">{meta}</span>
      </span>
      <span class="ed-grow__play" aria-hidden="true">
        <Icon name="play" /> PLAY
      </span>
    </button>
  )
}
