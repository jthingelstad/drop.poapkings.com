import MetaPageHead from '../components/MetaPageHead'
import MetaSection from '../components/MetaSection'
import { contactEmailHref, ELIXIR_DROP_CONTACT_EMAIL } from '../lib/links'

export default function Privacy() {
  return (
    <article class="ed-page ed-page--privacy">
      <MetaPageHead eyebrow="Player privacy" title="What Drop keeps—and why" />
      <p class="ed-page__intro">
        Elixir Drop keeps only the information needed to sign you in, send occasional release news, build your player
        profile, record games, and operate seasonal leaderboards.
      </p>

      <div class="ed-meta-sections">
        <MetaSection title="Your account">
          <p>
            Your email address is used for one-time magic-link sign-in and occasional Drop release news after you
            successfully use a sign-in link. It is never shown on your public profile. Drop stores your chosen player
            name, favorite-card avatar, game results, total games, per-card practice statistics derived from your
            recorded games (used only to deal you better practice rounds — never shown to other players), and optional
            Clash Royale player tag. All of it is removed when you delete your account.
          </p>
          <p>Magic-link messages come from elixir@poapkings.com.</p>
        </MetaSection>

        <MetaSection title="Your email address">
          <p>
            We will never sell or rent your email address, and we never use it for third-party marketing or advertising.
            After you successfully use a sign-in link, we add the address to Drop&rsquo;s Buttondown mailing list for
            occasional release news. Every release email includes an unsubscribe link.
          </p>
        </MetaSection>

        <MetaSection title="What other players can see">
          <p>
            Leaderboards can show your generated Drop name, favorite card, scores, total games, and attached player tag.
            When you attach a tag, Drop also shows public Clash Royale clan, card collection, and account-age data. Card
            levels, trophies, arenas, and experience level are not shown.
          </p>
        </MetaSection>

        <MetaSection title="Services Drop uses">
          <ul>
            <li>AWS runs the API and stores profiles and scores.</li>
            <li>Fastmail sends sign-in emails.</li>
            <li>
              Buttondown sends occasional Drop release news after you successfully use a sign-in link, and manages
              newsletter unsubscribes and delivery suppression.
            </li>
            <li>
              Tinylytics receives cookie-free aggregate site visits and named product events with broad game-mode or
              platform labels. Drop never sends it your email, public player name, player tag, score, run ID, or Drop
              session token.
            </li>
            <li>
              A private Discord operator log receives compact login and completed-game events using your public Drop
              identity, never your full email address.
            </li>
            <li>Supercell’s Clash Royale API supplies public data for an optional player tag.</li>
          </ul>
        </MetaSection>

        <MetaSection title="Fair play">
          <p>
            To keep leaderboards honest, Drop derives non-reversible fraud-prevention signals from the connection
            metadata on a recorded game—so we can tell when different accounts share one source. We do
            <strong> not</strong> store your IP address or full browser user-agent: they are converted into one-way,
            salted fingerprints the moment a game is recorded and the originals are discarded. Evidence retains only a
            coarse browser and operating-system family such as Chrome/macOS. These signals are used only to review
            competitive integrity, never for advertising or tracking, and they are removed with the rest of your data
            when you delete your account.
          </p>
          <p>
            Ranked games also record coarse input evidence: when each answer became available, when it was submitted,
            whether it came from a pointer or keyboard-like action, and whether the browser marked the event as trusted.
            Drop does <strong>not</strong> record pointer coordinates, pressure, pointer identity, or the key you
            pressed. This evidence is used only for competitive review and is removed when you delete your account.
          </p>
          <p>
            Automatic checks may temporarily withhold a leading or technically unusual result from placement while it is
            reviewed. The result and its review status remain visible to you. Confirmed automation can exclude the
            affected result; repeated or decisive abuse may lead to a separate restriction on future ranked play. Review
            evidence and private reasons are never published. The player receives only a brief, categorical explanation
            for an excluded run.
          </p>
        </MetaSection>

        <MetaSection title="Retention and deletion">
          <p>
            Magic links and signed run challenges expire quickly. Application logs are retained for 30 days. Your active
            profile and scores remain until you delete the account from your player profile.
          </p>
          <p>
            Account deletion removes your email, Drop identity, saved tag association, game history, and leaderboard
            entries from the active database and removes the matching Buttondown subscriber. Anonymous aggregate Trophy
            Road totals remain. Encrypted recovery backups and private operator event history may take longer to age
            out.
          </p>
        </MetaSection>

        <MetaSection title="Questions">
          <p>
            Email <a href={contactEmailHref('Elixir Drop question')}>{ELIXIR_DROP_CONTACT_EMAIL}</a> or ask in the
            Elixir Drop Discord.
          </p>
        </MetaSection>
      </div>

      <p class="ed-page__updated">Last updated August 13, 2026.</p>
    </article>
  )
}
