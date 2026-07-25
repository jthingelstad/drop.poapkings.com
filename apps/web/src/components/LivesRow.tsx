import Icon from './Icon'

// The lives row shared by every mode that has lives (Rain, Higher/Lower).
// It lives here rather than being copy-pasted per mode so the two can never
// drift apart visually — a player who learns to read the row in Rain reads the
// same row in Higher/Lower.
//
// Spent lives are NOT drawn with lucide's `heart-crack`. At the 1em size the
// game header gives it, the crack is a hairline and the two glyphs are the same
// silhouette, so a player has to squint to count what they have left. Instead
// every slot draws the SAME heart outline and the contrast carries the meaning:
// a life left is filled solid, a life spent is an empty dimmed outline. That
// difference survives a small glyph, a phone at arm's length, and red/green
// color blindness (it is fill vs no-fill, not red vs grey).
export default function LivesRow({ lives, max, testId }: { lives: number; max: number; testId: string }) {
  const left = Math.min(Math.max(0, lives), max)
  return (
    <span class="ed-lives" role="img" aria-label={`${left} of ${max} lives left`} data-testid={testId}>
      {Array.from({ length: max }, (_, index) => (
        <Icon
          key={index}
          name="heart"
          className={index < left ? 'ed-lives__heart' : 'ed-lives__heart ed-lives__heart--spent'}
        />
      ))}
    </span>
  )
}
