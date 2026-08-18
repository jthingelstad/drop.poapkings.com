// Skeleton rows for a wait where the screen already exists — a board, the log, a
// clan roster. The Ladder's header, scopes and mode tabs need no server, so a
// spinner in their place makes a fast app feel slow. Only the rows are skeletons,
// and skeletons say nothing: they are aria-hidden and carry no text.

export default function SkeletonRows({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div class={`ed-skeleton${className ? ` ${className}` : ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div class="ed-skeleton__row" key={i} />
      ))}
    </div>
  )
}
