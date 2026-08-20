import { allCards } from '../../lib/card-catalog'
// Falling Cards, as wallpaper.
//
// Desktop read sparse for two reasons and only one of them was emptiness: the
// aside repeated the page beside it, and 1050px of flat dark field had no job.
// The one asset Drop owns that is DESIGNED to fill idle space is the
// screensaver, and a margin is idle space — so the answer needed no new feature,
// only the two put together.
//
// Rules, all of them load-bearing:
//   · 5–15% opacity with a radial darkening toward the centre, so the column
//     always wins and the art never competes with a score.
//   · `pointer-events: none` — it is scenery, not a surface.
//   · Never over the shell; the stage and rails keep translucent backdrops.
//   · Reduced motion keeps the composition but freezes every card in place.
//
// It is CSS, not the Pixi scene. The screensaver is a foreground feature a
// player opts into for a few minutes; this sits behind the app for as long as
// the tab is open, and a permanent WebGL context is the wrong price for a
// background. The full-screen launcher stays in the aside — this replaces the
// empty field, not the feature.

// The scatter, straight from the design: position, size, tilt and opacity per
// slot. Fixed rather than random so the field is stable across a re-render and
// deterministic in a test.
const SLOTS: Array<{ left: number; top: number; width: number; rotate: number; opacity: number; duration: number }> = [
  { left: 4.1, top: 68.0, width: 61, rotate: 9.7, opacity: 0.11, duration: 19 },
  { left: 15.6, top: 81.5, width: 68, rotate: -19.6, opacity: 0.12, duration: 24 },
  { left: 51.4, top: 39.4, width: 95, rotate: -6.9, opacity: 0.11, duration: 27 },
  { left: 74.9, top: 30.9, width: 50, rotate: 7.3, opacity: 0.13, duration: 21 },
  { left: 23.3, top: 8.3, width: 63, rotate: 0.4, opacity: 0.09, duration: 29 },
  { left: 19.3, top: 30.9, width: 50, rotate: 16.3, opacity: 0.06, duration: 23 },
  { left: 48.2, top: 77.0, width: 54, rotate: -19.6, opacity: 0.08, duration: 25 },
  { left: 3.1, top: 20.9, width: 94, rotate: -17.6, opacity: 0.09, duration: 31 },
  { left: 95.2, top: 77.8, width: 96, rotate: 17.5, opacity: 0.1, duration: 26 },
  { left: 32.4, top: 14.5, width: 80, rotate: 20.6, opacity: 0.06, duration: 22 },
  { left: 63.1, top: 27.8, width: 58, rotate: 18.1, opacity: 0.12, duration: 28 },
  { left: 87.6, top: 88.3, width: 76, rotate: 0.2, opacity: 0.15, duration: 20 },
  { left: 35.8, top: 51.8, width: 77, rotate: -0.4, opacity: 0.08, duration: 32 },
  { left: 11.8, top: 37.2, width: 66, rotate: -20.9, opacity: 0.09, duration: 24 },
  { left: 4.7, top: 70.8, width: 48, rotate: 12.1, opacity: 0.11, duration: 30 },
  { left: 66.8, top: 97.2, width: 50, rotate: 9.1, opacity: 0.06, duration: 18 },
  { left: 57.5, top: 57.5, width: 70, rotate: 1.1, opacity: 0.12, duration: 27 },
  { left: 55.0, top: 33.6, width: 72, rotate: 12.9, opacity: 0.09, duration: 21 }
]

// Which cards fill the slots. Rotated by UTC day like the featured game, so the
// wallpaper turns over at one predictable moment rather than being either
// frozen forever or different on every render.
export function wallpaperCards(now: Date = new Date()): Array<{ id: number; icon: string; name: string }> {
  const catalog = allCards
  if (catalog.length === 0) return []
  const day = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000)
  return SLOTS.map((_, index) => {
    const card = catalog[(day * SLOTS.length + index) % catalog.length]!
    return { id: card.id, icon: card.icon, name: card.name }
  })
}

export default function DesktopWallpaper() {
  const cards = wallpaperCards()
  if (cards.length === 0) return null

  return (
    <div class="ed-wallpaper" aria-hidden="true">
      {SLOTS.map((slot, index) => (
        <img
          key={`${cards[index]!.id}-${index}`}
          class="ed-wallpaper__card"
          src={cards[index]!.icon}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            left: `${slot.left}%`,
            top: `${slot.top}%`,
            width: `${slot.width}px`,
            opacity: slot.opacity,
            animationDelay: `${index * -2.1}s`,
            animationDuration: `${slot.duration}s`,
            '--wallpaper-tilt': `${slot.rotate}deg`
          }}
        />
      ))}
      <span class="ed-wallpaper__vignette" />
    </div>
  )
}
