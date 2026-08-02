import type { BadgeView } from '../lib/badges'

// One badge medallion. The rim, plate and rung chip are CSS and recolour from
// ladder position — there is NO art variant per rung and no locked variant.
// One file per badge, forever: 29 images, not 182.
//
// The art box is 68% of the medallion diameter at every size, `object-fit:
// contain`, so a badge reads identically at 74px in the grid and 172px in the
// earn moment with no per-size tuning.
//
// Width and height are always explicit. Twenty-nine medallions reflowing as
// they decode is the worst thing this screen can do.
export default function BadgeMedallion({
  badge,
  size,
  file = 192
}: {
  badge: BadgeView
  size: number
  // -192 for the grid and detail sheet; -384 only in the earn celebration.
  file?: 192 | 384
}) {
  const art = Math.round(size * 0.68)
  const state = badge.concealed ? 'concealed' : badge.earned ? 'earned' : 'locked'
  return (
    <span
      class={`badge-med badge-med--${badge.tier} badge-med--${state}`}
      style={{ width: `${size}px`, height: `${size}px` }}
      data-slug={badge.slug}
    >
      <span class="badge-med__plate" aria-hidden="true" />
      <img
        src={`/assets/badges/${badge.slug}-${file}.png`}
        width={art}
        height={art}
        alt=""
        aria-hidden="true"
        class="badge-med__art"
      />
      {badge.chip && <span class="badge-med__chip">{badge.chip}</span>}
    </span>
  )
}
