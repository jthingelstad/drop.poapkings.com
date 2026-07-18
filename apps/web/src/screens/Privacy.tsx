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
            stores your chosen player name, favorite-card avatar, game results, total games, and optional Clash Royale
            player tag.
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

        <p class="privacy-card__updated">Last updated July 18, 2026.</p>
      </article>
    </div>
  )
}
