import Icon from './Icon'

// Shown when the server dealt a non-uniform challenge (linked-collection pool
// or focused practice): the run records history and Trophy Road, but does not
// place on the leaderboards.
export default function RunScopeBadge({ ranked }: { ranked: boolean }) {
  if (ranked) return null
  return (
    <p class="run-scope" data-testid="run-scope">
      <Icon name="target" /> Practice run — dealt from your cards, not ranked
    </p>
  )
}
