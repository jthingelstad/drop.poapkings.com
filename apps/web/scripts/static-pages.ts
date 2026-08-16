import releaseData from '../src/data/releases.json' with { type: 'json' }

export const STATIC_PAGE_SLUGS = ['about', 'faq', 'fair-play', 'privacy', 'releases', 'install'] as const
export type StaticPageSlug = (typeof STATIC_PAGE_SLUGS)[number]

interface StaticPage {
  eyebrow: string
  title: string
  description: string
  body: string
}

interface ReleaseEntry {
  id: string
  name: string
  date: string
  build: string
  headline: string
  notes: string[]
  beta?: boolean
}

const SITE_URL = 'https://drop.poapkings.com'
const CONTACT = 'drop@poapkings.com'
const POLICY_NOTICE =
  'This material is unofficial and is not endorsed by Supercell. For more information see Supercell’s Fan Content Policy: www.supercell.com/fan-content-policy.'

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] ?? character
  )
}

function section(title: string, body: string, muted = false): string {
  return `<section class="static-section${muted ? ' static-section--muted' : ''}">
    <h2>${escapeHtml(title)}</h2>
    <div class="static-section__body">${body}</div>
  </section>`
}

function paragraph(copy: string): string {
  return `<p>${copy}</p>`
}

function pageSections(sections: string[]): string {
  return `<div class="static-sections">${sections.join('\n')}</div>`
}

function releaseDateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

function releasesBody(): string {
  const releases = (releaseData as { releases: ReleaseEntry[] }).releases
  if (releases.length === 0) {
    return pageSections([section('Nothing released yet', paragraph('The first named release will appear here.'), true)])
  }
  return `<p class="static-intro">Every named Elixir Drop release, newest first—what changed and when it landed.</p>
  ${pageSections(
    releases.map((entry) =>
      section(
        entry.name,
        `<p class="static-release-stamp">${entry.beta ? '<span>Beta</span>' : ''}${escapeHtml(
          releaseDateLabel(entry.date)
        )} · build <code>${escapeHtml(entry.build)}</code></p>${entry.notes
          .map((note) => paragraph(escapeHtml(note)))
          .join('')}`
      )
    )
  )}`
}

const ABOUT_BODY = pageSections([
  section(
    'Built for fast reads',
    paragraph(
      'Elixir Drop is a free browser game for learning Clash Royale card elixir costs through fast, replayable games.'
    )
  ),
  section(
    'Six ways to train',
    paragraph(
      'Practice teaches without a clock. Surge races through 15 cards. Higher / Lower and Trade test comparison, Survival is sudden death, and Rain drops cards you must clear before they land.'
    )
  ),
  section(
    'Play, improve, compete',
    paragraph(
      'Every mode works without an account. Sign in when you want to save progress and post eligible ranked scores to seasonal and all-time leaderboards. Leading results may rank provisionally while Fair Play reviews them.'
    )
  ),
  section(
    'Contact Drop',
    paragraph(
      `Questions, feedback, privacy requests, or help with a result? Email <a href="mailto:${CONTACT}">${CONTACT}</a>. Sign-in magic links come from elixir@poapkings.com.`
    )
  ),
  section(
    'Fan content',
    `${paragraph(
      'This fan community is not affiliated with Supercell. Clash Royale is a trademark of its respective owner. Card data and artwork © Supercell, used under Supercell’s Fan Content Policy.'
    )}${paragraph(POLICY_NOTICE)}`,
    true
  )
])

const FAQ_ITEMS = [
  [
    'Do I need an account?',
    'No. You can play every mode as a guest. Signing in with your email saves scores, levels, and leaderboard placement across devices.'
  ],
  [
    'How does sign-in work?',
    'There is no password. Enter your email and Drop sends a one-tap magic link from elixir@poapkings.com.'
  ],
  [
    'Are the elixir costs official?',
    'Card costs mirror the live Clash Royale card set. When Supercell rebalances a card, Drop updates its catalog.'
  ],
  [
    'What counts for the leaderboards?',
    'Signed-in scores from ranked modes are eligible for season and all-time boards. Guest and Practice runs never rank. Leading or technically unusual results may rank provisionally while Fair Play reviews them.'
  ],
  [
    'What do the Fair Play seals mean?',
    'Most games are never reviewed and carry no seal. Awaiting means a referee is checking the run while it ranks provisionally. Cleared means a referee checked that exact run and it remains eligible. Excluded means the run leaves the board. Automatic checks start review but never decide it.'
  ],
  [
    'How do I contact Drop or dispute a run?',
    `Email <a href="mailto:${CONTACT}">${CONTACT}</a> for questions, feedback, privacy requests, or a Fair Play re-review. Include the run tag shown in your game history when asking about a result.`
  ],
  [
    'Is Elixir Drop made by Supercell?',
    'No. It is a fan-made trainer run by POAP KINGS and is not affiliated with or endorsed by Supercell.'
  ],
  [
    'How do I install it on my phone?',
    'Open the Install page and follow the steps. Adding Drop to your home screen removes the browser bars for a full-screen game.'
  ]
] as const

const FAQ_BODY = pageSections(FAQ_ITEMS.map(([question, answer]) => section(question, paragraph(answer))))

const FAIR_PLAY_BODY = `<p class="static-intro">Drop is open source, and learning how it works is welcome. Ranked results still have one simple requirement: a person must deliberately choose every answer through the game&rsquo;s controls.</p>
${pageSections([
  section(
    'Play as a person',
    paragraph(
      'Scripts, bots, automatic answer selection, direct API play, replayed requests, and falsified timing evidence are not eligible for rankings. Built-in settings such as Reduce motion and Speedrun keyboard—and ordinary accessibility tools—are allowed when the player still chooses each answer.'
    )
  ),
  section(
    'How review works',
    `${paragraph(
      'Leading or technically unusual results may be reviewed. A referee reviews the exact run, including its signed challenge, answer sequence, active response timing, rules version, and relevant play history. An automatic signal starts review; it is never a verdict by itself. A run ranks provisionally while it waits.'
    )}${paragraph(
      '<strong>Most games are never reviewed, and they carry no mark at all.</strong> A seal appears only where a referee has handled the run.'
    )}<ul class="static-statuses"><li><strong>Awaiting</strong><span>A referee is checking the run. It ranks provisionally and its placement can still change.</span></li><li><strong>Cleared</strong><span>A referee checked this exact run and it remains eligible for its correct placement.</span></li><li><strong>Excluded</strong><span>The run leaves the board. The player&rsquo;s next eligible result can still rank, and a later re-review can restore the run.</span></li></ul>`
  ),
  section(
    'Recorded holds and unrecorded attempts',
    paragraph(
      'When Drop can reproduce a score but needs an authenticity review, it records the game, ranks it, and marks that run Awaiting. If incomplete or contradictory input leaves no reproducible score, Drop cannot record a ranked result; the on-screen notice provides a short run tag for referee lookup while evidence remains available.'
    )
  ),
  section(
    'Results and accounts',
    paragraph(
      'Drop excludes the specific performance when strong evidence shows it was fabricated or materially assisted by automation. Repeated confirmed violations or one decisive tampering case may lead to a separate, reversible restriction on future ranked play after operator approval. Practice remains available.'
    )
  ),
  section(
    'Privacy and re-review',
    paragraph(
      `Review evidence stays private. Drop does not publish accusations, answer transcripts, connection fingerprints, or private reasons. If you believe a result or ranked-access decision is wrong, email <a href="mailto:${CONTACT}?subject=Elixir%20Drop%20Fair%20Play%20re-review">${CONTACT}</a> and include the run tag when the request concerns a specific result.`
    )
  )
])}`

const PRIVACY_BODY = `<p class="static-intro">Elixir Drop keeps only the information needed to sign you in, send player updates, build your profile, record games, and operate seasonal leaderboards.</p>
${pageSections([
  section(
    'Your account',
    `${paragraph(
      'Your email address is used for one-time magic-link sign-in and occasional player updates. It is never shown on your public profile. Drop stores your chosen player name, favorite-card avatar, game results, total games, per-card practice statistics derived from recorded games—including first-response time and whether choices or a requested hint were used. Those statistics are used only to deal you better practice rounds and are never shown to other players. Drop also stores an optional Clash Royale player tag. All of it is removed when you delete your account.'
    )}${paragraph('Magic-link messages come from elixir@poapkings.com.')}`
  ),
  section(
    'Your email address',
    paragraph(
      'Drop never sells or rents your email address and never uses it for third-party marketing or advertising. Player update emails include an unsubscribe link.'
    )
  ),
  section(
    'What other players can see',
    paragraph(
      'Leaderboards can show your generated Drop name, favorite card, scores, total games, and attached player tag. When you attach a tag, Drop also shows public Clash Royale clan, card collection, and account-age data. Card levels, trophies, arenas, and experience level are not shown.'
    )
  ),
  section(
    'Services Drop uses',
    '<ul><li>AWS runs the API and stores profiles and scores.</li><li>Fastmail sends sign-in emails.</li><li>Buttondown sends occasional player updates and manages unsubscribes and delivery suppression.</li><li>Tinylytics receives cookie-free aggregate site visits and named product events with broad game-mode or platform labels. For events confirmed by the API, Drop forwards your connection IP address and browser user-agent so Tinylytics can associate the outcome with the same anonymous visit and derive country and browser context. Drop does not store or log those raw values for analytics. Tinylytics says it discards raw IPs after country lookup, may use IPinfo when its local lookup cannot resolve a country, and removes user-agent strings after seven days. Drop never sends Tinylytics your email, public player name, player tag, score, run ID, or session token.</li><li>A private Discord operator log receives compact login and completed-game events using your public Drop identity, never your full email address.</li><li>Supercell&rsquo;s Clash Royale API supplies public data for an optional player tag.</li></ul>'
  ),
  section(
    'Fair Play',
    `${paragraph(
      'To keep leaderboards honest, Drop derives non-reversible fraud-prevention signals from connection metadata on a recorded game. It does not store the raw IP address or full browser user-agent for Fair Play; they become one-way, salted fingerprints and coarse browser and operating-system families.'
    )}${paragraph(
      'Ranked games also record coarse input evidence: when each answer became available, when it was submitted, whether it came from a pointer or keyboard-like action, and whether the browser marked the event as trusted. Drop does not record pointer coordinates, pressure, pointer identity, or the key pressed.'
    )}${paragraph(
      'Automatic checks may start review of a leading or technically unusual result. They never make the final decision. Review evidence and private reasons are not published.'
    )}`
  ),
  section(
    'Retention and deletion',
    `${paragraph(
      'Magic links and signed run challenges expire quickly. Application logs are retained for 30 days. Your active profile and scores remain until you delete the account from your player profile.'
    )}${paragraph(
      'Account deletion removes your email, Drop identity, saved tag association, game history, and leaderboard entries from the active database and removes the matching Buttondown player-update subscription. Anonymous aggregate Trophy Road totals remain. Encrypted recovery backups and private operator event history may take longer to age out.'
    )}`
  ),
  section('Questions', paragraph(`Email <a href="mailto:${CONTACT}?subject=Elixir%20Drop%20question">${CONTACT}</a>.`))
])}<p class="static-updated">Last updated August 16, 2026.</p>`

const INSTALL_BODY = `<p class="static-intro">Add Drop to your home screen and the browser bars disappear—more room for falling cards, a cleaner game, and a one-tap launch icon.</p>
${pageSections([
  section(
    'iPhone · Safari',
    '<ol><li>Tap the Share button in the Safari toolbar.</li><li>Scroll and choose <strong>Add to Home Screen</strong>.</li><li>Tap Add. The Drop icon appears on your home screen.</li></ol>'
  ),
  section(
    'Android · Chrome',
    '<ol><li>Tap the menu in the top-right of Chrome.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Confirm. Drop installs like a native app.</li></ol>'
  )
])}`

const PAGES: Record<StaticPageSlug, StaticPage> = {
  about: {
    eyebrow: 'What is this',
    title: 'About Elixir Drop',
    description:
      'Learn what Elixir Drop is, how its six Clash Royale elixir-cost games work, and how to contact the team.',
    body: ABOUT_BODY
  },
  faq: {
    eyebrow: 'Good to know',
    title: 'Elixir Drop FAQ',
    description:
      'Answers about Elixir Drop accounts, elixir costs, leaderboards, Fair Play, installation, and support.',
    body: FAQ_BODY
  },
  'fair-play': {
    eyebrow: 'Competitive integrity',
    title: 'Elixir Drop Fair Play',
    description:
      'How Elixir Drop reviews ranked results, treats automated signals, protects evidence, and handles re-review requests.',
    body: FAIR_PLAY_BODY
  },
  privacy: {
    eyebrow: 'Player privacy',
    title: 'Elixir Drop Privacy',
    description:
      'What Elixir Drop stores, what other players can see, which services it uses, and how account deletion works.',
    body: PRIVACY_BODY
  },
  releases: {
    eyebrow: 'What shipped',
    title: 'Elixir Drop Releases',
    description: 'The named Elixir Drop release history, newest first, with the changes included in each release.',
    body: releasesBody()
  },
  install: {
    eyebrow: 'Full-screen play',
    title: 'Install Elixir Drop',
    description: 'Add Elixir Drop to an iPhone or Android home screen for full-screen play and one-tap launching.',
    body: INSTALL_BODY
  }
}

function pageNav(current: StaticPageSlug): string {
  return STATIC_PAGE_SLUGS.map((slug) => {
    const label = slug === 'fair-play' ? 'Fair Play' : slug[0]!.toUpperCase() + slug.slice(1)
    return `<a href="/${slug}/"${slug === current ? ' aria-current="page"' : ''}>${label}</a>`
  }).join('')
}

export function renderStaticPage(slug: StaticPageSlug): string {
  const page = PAGES[slug]
  const canonical = `${SITE_URL}/${slug}/`
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    url: canonical,
    description: page.description,
    isPartOf: { '@type': 'WebSite', name: 'Elixir Drop', url: `${SITE_URL}/` }
  }).replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#070610">
  <title>${escapeHtml(page.title)} | Elixir Drop</title>
  <meta name="description" content="${escapeHtml(page.description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Elixir Drop">
  <meta property="og:title" content="${escapeHtml(page.title)} | Elixir Drop">
  <meta property="og:description" content="${escapeHtml(page.description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${SITE_URL}/assets/og-image.png">
  <meta property="og:image:alt" content="Elixir Drop">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(page.title)} | Elixir Drop">
  <meta name="twitter:description" content="${escapeHtml(page.description)}">
  <meta name="twitter:image" content="${SITE_URL}/assets/og-image.png">
  <link rel="icon" href="/assets/icon/drop-icon-192.png">
  <link rel="stylesheet" href="/static-pages.css">
  <script type="application/ld+json">${schema}</script>
</head>
<body>
  <header class="static-header">
    <div class="static-wrap static-header__row">
      <a class="static-brand" href="/" aria-label="Elixir Drop home">
        <img src="/assets/icon/drop-icon-192.png" width="42" height="42" alt="">
        <span>Elixir Drop</span>
      </a>
      <a class="static-play" href="/" data-tinylytics-event="static.play">Play</a>
    </div>
    <nav class="static-wrap static-nav" aria-label="Elixir Drop information">${pageNav(slug)}</nav>
  </header>
  <main class="static-wrap static-main">
    <header class="static-title">
      <p>${escapeHtml(page.eyebrow)}</p>
      <h1>${escapeHtml(page.title)}</h1>
      <span>Run by <a href="https://poapkings.com/elixir-drop/">POAP KINGS</a>.</span>
    </header>
    ${page.body}
    <section class="static-cta">
      <h2>Ready to play?</h2>
      <p>Learn the card costs, test your speed, and see where you rank.</p>
      <a href="/" data-tinylytics-event="static.play-final">Play Elixir Drop →</a>
    </section>
  </main>
  <footer class="static-footer">
    <div class="static-wrap">
      <p><a href="mailto:${CONTACT}">${CONTACT}</a> · <a href="https://poapkings.com/elixir-drop/">Run by POAP KINGS</a></p>
      <p>${POLICY_NOTICE}</p>
    </div>
  </footer>
  <script defer src="https://tinylytics.app/embed/JjqvUeyEnrPM1f_iXrbU/min.js?events&amp;beacon"></script>
</body>
</html>\n`
}
