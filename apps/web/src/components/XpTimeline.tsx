import { useSignal } from '@preact/signals'
import type { XpTimeline, XpTimelineSource } from '../lib/api-contracts'
import { arenaProgress } from './ArenaProgress'
import Icon from './Icon'

const DAY_BATCH = 14

const SOURCE_LABELS: Record<XpTimelineSource, string> = {
  game: 'Games',
  practice: 'Practice',
  'legacy-run': 'Games',
  'personal-best': 'Personal bests',
  'daily-featured': 'Featured game',
  badge: 'Badges',
  'season-placement': 'Season finish',
  'season-circuit': 'Seasonal Circuit'
}

function dateLabel(date: string): string {
  if (date === new Date().toISOString().slice(0, 10)) return 'Today'
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  })
}

function sourceLine(day: XpTimeline['days'][number]): string {
  const grouped = new Map<string, number>()
  for (const source of day.sources) {
    const label = SOURCE_LABELS[source.source]
    grouped.set(label, (grouped.get(label) ?? 0) + source.xp)
  }
  return [...grouped].map(([label, xp]) => `${label} +${xp.toLocaleString()}`).join(' · ')
}

export default function XpTimelinePanel({
  timeline,
  stale = false,
  historyUnavailable = false
}: {
  timeline: XpTimeline
  stale?: boolean
  historyUnavailable?: boolean
}) {
  const visibleDayCount = useSignal(DAY_BATCH)
  const arena = arenaProgress(timeline.totalXp)
  const visibleDays = timeline.days.slice(0, visibleDayCount.value)
  const hiddenDays = Math.max(0, timeline.days.length - visibleDays.length)

  return (
    <section class={`ed-xp${stale ? ' ed-xp--stale' : ''}`} aria-labelledby="xp-history-title">
      <div class="ed-xp__hero">
        <div class="ed-xp__arena-kicker">
          Arena {arena.current.n} of 28{stale ? ' · Last known' : ''}
        </div>
        <div class="ed-xp__arena-row">
          <strong class="ed-xp__arena-name">{arena.current.name}</strong>
          <strong class="ed-xp__total">{timeline.totalXp.toLocaleString()} XP</strong>
        </div>
        <div
          class="ed-xp__progress"
          role="progressbar"
          aria-label="Arena XP progress"
          aria-valuemin={arena.current.threshold}
          aria-valuemax={arena.next?.threshold ?? arena.current.threshold}
          aria-valuenow={timeline.totalXp}
        >
          <span style={{ width: `${arena.fillPct}%` }} />
        </div>
        <div class="ed-xp__progress-copy">
          <span>{arena.toGoLabel}</span>
          <a href="/xp/">XP rules</a>
        </div>
      </div>

      <div class="ed-xp__history-head">
        <h2 id="xp-history-title">How your XP grew</h2>
        {!historyUnavailable && (
          <strong>
            +{timeline.attributedXp.toLocaleString()} across {timeline.days.length.toLocaleString()}{' '}
            {timeline.days.length === 1 ? 'day' : 'days'}
          </strong>
        )}
      </div>
      <p class="ed-xp__utc">
        {historyUnavailable ? 'Reconnect to load the daily detail.' : 'XP days reset at 00:00 UTC.'}
      </p>

      {visibleDays.length ? (
        <ol class="ed-xp__days">
          {visibleDays.map((day) => (
            <li class="ed-xp__day" key={day.date}>
              <span class="ed-xp__day-mark" aria-hidden="true">
                <Icon name="zap" />
              </span>
              <span class="ed-xp__day-copy">
                <strong>{dateLabel(day.date)}</strong>
                <small>{sourceLine(day)}</small>
              </span>
              <strong class="ed-xp__day-total">+{day.xp.toLocaleString()}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <div class="ed-xp__empty">
          {historyUnavailable
            ? 'Your last-known arena is safe. Offline games never change saved XP.'
            : 'Your next XP award starts the detailed history.'}
        </div>
      )}

      {hiddenDays > 0 && (
        <button class="ed-textlink ed-xp__more" type="button" onClick={() => (visibleDayCount.value += DAY_BATCH)}>
          Show {Math.min(DAY_BATCH, hiddenDays)} earlier {hiddenDays === 1 ? 'day' : 'days'}
          <Icon name="chevron-down" />
        </button>
      )}

      {timeline.openingBalance > 0 && (
        <div class="ed-xp__opening">
          <span>Earlier XP carried into this history</span>
          <strong>{timeline.openingBalance.toLocaleString()} XP</strong>
        </div>
      )}
    </section>
  )
}
