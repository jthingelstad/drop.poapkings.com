// The gold animated "ELIXIR DROP / Run by POAP KINGS" wordmark. Shimmer is CSS
// (.ed-wordmark) and disabled under reduced motion.
//
// `onLogoTap` is the Elixir Rain easter egg (five quick taps). It belongs on the
// LOGO — the function is named for it — which is why the mark itself becomes a
// button when a tap handler is supplied instead of a second link to the clan
// site: five taps must not open five tabs. The quiet, always-present "Run by
// POAP KINGS" clan link below it is unchanged either way.

const POAP_KINGS = 'https://poapkings.com'

export default function Wordmark({ className, onLogoTap }: { className?: string; onLogoTap?: () => void }) {
  return (
    <div class={className}>
      {onLogoTap ? (
        <button type="button" class="ed-wordmark ed-wordmark--tap" onClick={() => onLogoTap()}>
          ELIXIR&nbsp;DROP
        </button>
      ) : (
        <a
          href={POAP_KINGS}
          target="_blank"
          rel="noopener noreferrer"
          class="ed-wordmark"
          aria-label="Elixir Drop — Run by POAP KINGS"
        >
          ELIXIR&nbsp;DROP
        </a>
      )}
      <a href={POAP_KINGS} target="_blank" rel="noopener noreferrer" class="ed-wordmark__by">
        Run by POAP KINGS
      </a>
    </div>
  )
}
