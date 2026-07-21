export default function Privacy() {
  return (
    <div class="main-content privacy-screen">
      <article class="privacy-card">
        <div class="eyebrow">Player privacy</div>
        <h1>What Drop keeps—and why</h1>
        <p class="lede">
          Elixir Drop keeps only the information needed to sign you in, build your player profile, record games, and
          operate seasonal leaderboards.
        </p>

        <section>
          <h2>Your account</h2>
          <p>
            Your email address is used for one-time magic-link sign-in and is never shown on your public profile. Drop
            stores your chosen player name, favorite-card avatar, game results, total games, per-card practice
            statistics derived from your recorded games (used only to deal you better practice rounds — never shown to
            other players), and optional Clash Royale player tag. All of it is removed when you delete your account.
          </p>
        </section>

        <section>
          <h2>Your email address</h2>
          <p>
            We will never sell, rent, or share your email address, and we never use it for third-party marketing or
            advertising. We do intend to email you occasional Drop release news about upcoming versions of Elixir Drop,
            and we may add you to an Elixir Drop mailing list in the future. It stays between you and the people who run
            Drop.
          </p>
        </section>

        <section>
          <h2>What other players can see</h2>
          <p>
            Leaderboards can show your generated Drop name, favorite card, scores, total games, and attached player tag.
            When you attach a tag, Drop also shows public Clash Royale clan, card collection, and account-age data. Card
            levels, trophies, arenas, and experience level are not shown.
          </p>
        </section>

        <section>
          <h2>Services Drop uses</h2>
          <ul>
            <li>AWS runs the API and stores profiles and scores.</li>
            <li>Fastmail sends sign-in emails.</li>
            <li>Tinylytics receives aggregate site visits and named game events, not your email or Drop session.</li>
            <li>
              A private Discord operator log receives compact login and completed-game events using your public Drop
              identity, never your full email address.
            </li>
            <li>Supercell’s Clash Royale API supplies public data for an optional player tag.</li>
          </ul>
        </section>

        <section>
          <h2>Fair play</h2>
          <p>
            To keep leaderboards honest, Drop derives non-reversible fraud-prevention signals from the connection
            metadata on a recorded game—so we can tell when different accounts share one source. We do
            <strong> not</strong> store your IP address or your browser's user-agent: they are converted into one-way,
            salted fingerprints the moment a game is recorded and the originals are discarded. These signals are used
            only to review competitive integrity, never for advertising or tracking, and they are removed with the rest
            of your data when you delete your account.
          </p>
        </section>

        <section>
          <h2>Retention and deletion</h2>
          <p>
            Magic links and signed run challenges expire quickly. Application logs are retained for 30 days. Your active
            profile and scores remain until you delete the account from your player profile.
          </p>
          <p>
            Account deletion removes your email, Drop identity, saved tag association, game history, and leaderboard
            entries from the active database. Anonymous aggregate Trophy Road totals remain. Encrypted recovery backups
            and private operator event history may take longer to age out.
          </p>
        </section>

        <section>
          <h2>Questions</h2>
          <p>
            Email <a href="mailto:elixir@poapkings.com">elixir@poapkings.com</a> or ask in the Elixir Drop Discord.
          </p>
        </section>

        <p class="privacy-card__updated">Last updated July 19, 2026.</p>
      </article>
    </div>
  )
}
