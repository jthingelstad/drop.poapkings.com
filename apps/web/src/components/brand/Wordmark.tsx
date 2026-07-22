// The gold animated "ELIXIR DROP / by the POAP KINGS" wordmark. Links to the
// clan site. Shimmer is CSS (.ed-wordmark) and disabled under reduced motion.

const POAP_KINGS = 'https://poapkings.com'

export default function Wordmark({ className }: { className?: string }) {
  return (
    <div class={className}>
      <a
        href={POAP_KINGS}
        target="_blank"
        rel="noopener noreferrer"
        class="ed-wordmark"
        aria-label="Elixir Drop — by the POAP KINGS"
      >
        ELIXIR&nbsp;DROP
      </a>
      <a href={POAP_KINGS} target="_blank" rel="noopener noreferrer" class="ed-wordmark__by">
        by the POAP KINGS
      </a>
    </div>
  )
}
