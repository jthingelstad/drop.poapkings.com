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
//   · Full-strength card art: no opacity, brightness, saturation, or vignette
//     treatment. Z-order alone keeps the shell above the animation.
//   · `pointer-events: none` — it is scenery, not a surface.
//   · Never over the shell; the stage and rails keep translucent backdrops.
//   · Reduced motion keeps the composition but freezes every card in place.
//
// It is CSS, not the Pixi scene. The screensaver is a foreground feature a
// player opts into for a few minutes; this sits behind the app for as long as
// the tab is open, and a permanent WebGL context is the wrong price for a
// background. The full-screen launcher stays in the aside — this replaces the
// empty field, not the feature.

// The scatter, straight from the design: position, size and tilt per
// slot. Fixed rather than random so the field is stable across a re-render and
// deterministic in a test.
const SLOTS: Array<{ left: number; top: number; width: number; rotate: number; duration: number }> = [
  { left: 3.5, top: 68.0, width: 78, rotate: 9.7, duration: 19 },
  { left: 9.5, top: 18.5, width: 92, rotate: -19.6, duration: 24 },
  { left: 15.5, top: 43.0, width: 72, rotate: -6.9, duration: 27 },
  { left: 21.0, top: 78.0, width: 84, rotate: 7.3, duration: 21 },
  { left: 27.0, top: 8.3, width: 68, rotate: 0.4, duration: 29 },
  { left: 33.0, top: 55.0, width: 76, rotate: 16.3, duration: 23 },
  { left: 40.0, top: 86.0, width: 64, rotate: -19.6, duration: 25 },
  { left: 46.0, top: 25.0, width: 90, rotate: -17.6, duration: 31 },
  { left: 54.0, top: 74.0, width: 94, rotate: 17.5, duration: 26 },
  { left: 60.0, top: 13.0, width: 76, rotate: 20.6, duration: 22 },
  { left: 67.0, top: 42.0, width: 70, rotate: 18.1, duration: 28 },
  { left: 73.0, top: 88.0, width: 88, rotate: 0.2, duration: 20 },
  { left: 79.0, top: 28.0, width: 82, rotate: -0.4, duration: 32 },
  { left: 84.5, top: 62.0, width: 74, rotate: -20.9, duration: 24 },
  { left: 90.5, top: 14.0, width: 96, rotate: 12.1, duration: 30 },
  { left: 96.5, top: 76.0, width: 80, rotate: 9.1, duration: 18 },
  { left: 12.5, top: 92.0, width: 70, rotate: 1.1, duration: 27 },
  { left: 87.5, top: 48.0, width: 86, rotate: 12.9, duration: 21 }
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
          decoding="async"
          style={{
            left: `${slot.left}%`,
            top: `${slot.top}%`,
            width: `${slot.width}px`,
            animationDelay: `${index * -2.1}s`,
            animationDuration: `${slot.duration}s`,
            '--wallpaper-tilt': `${slot.rotate}deg`
          }}
        />
      ))}
    </div>
  )
}
