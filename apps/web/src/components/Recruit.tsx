import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { pickLine } from '../lib/elixir-lines'
import { track } from '../lib/analytics'
import { ELIXIR_DROP_DISCORD_URL } from '../lib/links'
import Icon from './Icon'
import type { GameMode } from '@elixir-drop/contracts'

const CLAN_INVITE = 'https://link.clashroyale.com/invite/clan/en?tag=J2RGCRVG&token=dtw94pzg'

// The clan is usually full, so we mirror the site's JOIN/WAIT pattern and lead
// with Discord when full. Flip this if the clan opens up.
const CLAN_FULL = true

// An earned-moment ask: one Elixir recruit line + a single primary CTA.
// Rendered only inside a summary after a PB or a strong session — never on load.
export default function Recruit({ mode }: { mode: GameMode }) {
  const line = useSignal(pickLine('recruit'))

  useEffect(() => {
    track('community.recruit_shown', mode)
  }, [mode])

  const primaryDiscord = (
    <>
      <a
        class="btn btn--gold recruit__cta"
        href={ELIXIR_DROP_DISCORD_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track('community.discord_opened', mode)}
      >
        Join the Elixir Drop Discord <Icon name="arrow-right" />
      </a>
      <a
        class="recruit__alt"
        href={CLAN_INVITE}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track('community.clan_opened', mode)}
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
        onClick={() => track('community.clan_opened', mode)}
      >
        Join POAP KINGS <Icon name="arrow-right" />
      </a>
      <a
        class="recruit__alt"
        href={ELIXIR_DROP_DISCORD_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => track('community.discord_opened', mode)}
      >
        or join the Elixir Drop Discord first
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
