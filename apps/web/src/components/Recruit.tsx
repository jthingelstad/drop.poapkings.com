import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { pickLine } from '../lib/elixir-lines'
import { track } from '../lib/analytics'

const CLAN_INVITE = 'https://link.clashroyale.com/invite/clan/en?tag=J2RGCRVG&token=dtw94pzg'
const DISCORD = 'https://discord.gg/kBD62fYHWx'

// The clan is usually full, so we mirror the site's JOIN/WAIT pattern and lead
// with Discord when full. Flip this if the clan opens up.
const CLAN_FULL = true

// An earned-moment ask: one Elixir recruit line + a single primary CTA.
// Rendered only inside a summary after a PB or a strong session — never on load.
export default function Recruit() {
  const line = useSignal(pickLine('recruit'))

  useEffect(() => {
    track('recruit.shown')
  }, [])

  const primaryDiscord = (
    <>
      <a
        class="btn btn--gold recruit__cta"
        href={DISCORD}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track('recruit.discord')}
      >
        Join the POAP KINGS Discord →
      </a>
      <a
        class="recruit__alt"
        href={CLAN_INVITE}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track('recruit.join')}
      >
        clan's often full — try the in-game invite
      </a>
    </>
  )

  const primaryClan = (
    <>
      <a
        class="btn btn--gold recruit__cta"
        href={CLAN_INVITE}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track('recruit.join')}
      >
        Join POAP KINGS →
      </a>
      <a
        class="recruit__alt"
        href={DISCORD}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track('recruit.discord')}
      >
        or hop in the Discord first
      </a>
    </>
  )

  return (
    <div class="recruit">
      <div class="recruit__line">{line.value}</div>
      {CLAN_FULL ? primaryDiscord : primaryClan}
    </div>
  )
}
