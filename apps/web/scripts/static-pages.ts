import { BADGE_LIST, type BadgeDefinition, type GameMode } from '@elixir-drop/contracts'
import cardData from '../../../packages/game-data/cards.json' with { type: 'json' }
import { GAME_CATALOG as GAMES } from '../src/lib/game-catalog.ts'
import { editorialEntries, type UpdateKind } from '../src/lib/update-data.ts'
import { renderUpdateMarkdownHtml } from '../src/lib/update-markdown.ts'

export const STATIC_PAGE_SLUGS = [
  'games',
  'learn-elixir-costs',
  'elixir-costs',
  'badges',
  'discord',
  'install',
  'fair-play',
  'about',
  'faq',
  'privacy',
  'updates'
] as const
export type StaticPageSlug = (typeof STATIC_PAGE_SLUGS)[number]

interface SchemaItem {
  name: string
  url: string
  description?: string
}

interface StaticPage {
  eyebrow: string
  title: string
  description: string
  body: string
  schemaType?: 'WebPage' | 'CollectionPage'
  schemaItems?: SchemaItem[]
}

interface CardEntry {
  id: number
  name: string
  elixir: number
  rarity: string
  type: string
}

const SITE_URL = 'https://drop.poapkings.com'
const CONTACT = 'drop@poapkings.com'
const DISCORD_URL = 'https://discord.gg/SdvKfJW5kA'
const POLICY_NOTICE =
  'This material is unofficial and is not endorsed by Supercell. For more information see Supercell’s Fan Content Policy: www.supercell.com/fan-content-policy.'
const PRIMARY_NAV: ReadonlyArray<{ slug: StaticPageSlug; label: string }> = [
  { slug: 'games', label: 'Game Modes' },
  { slug: 'learn-elixir-costs', label: 'Learn Elixir Costs' },
  { slug: 'install', label: 'Game Setup' },
  { slug: 'fair-play', label: 'Fair Play' },
  { slug: 'about', label: 'About' },
  { slug: 'faq', label: 'FAQ' }
]

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] ?? character
  )
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase())
}

function section(title: string, body: string, muted = false, id?: string): string {
  return `<section${id ? ` id="${escapeHtml(id)}"` : ''} class="static-section${muted ? ' static-section--muted' : ''}">
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

function playLink(path: string, label: string, event: string): string {
  return `<a class="static-inline-cta" href="/#${path}" data-tinylytics-event="${event}">${escapeHtml(label)} →</a>`
}

function dateLabel(value: string): string {
  const parsed = new Date(value.includes('T') ? value : `${value}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

function updateKindLabel(kind: UpdateKind): string {
  return kind === 'feature' ? 'Feature' : kind === 'season' ? 'Season' : 'Message'
}

function updatesBody(): string {
  const updates = editorialEntries()
  if (updates.length === 0) {
    return pageSections([section('The arena is quiet', paragraph('The first player update will appear here.'), true)])
  }
  return `<p class="static-intro">New features, season winners, and player messages—one clear update at a time. <a href="/feed.xml">Follow via RSS</a>.</p>
  ${pageSections(
    updates.map((entry) =>
      section(
        entry.title,
        `<p class="static-update-stamp"><span>${updateKindLabel(entry.kind)}</span>${escapeHtml(
          dateLabel(entry.publishedAt)
        )}</p>${paragraph(renderUpdateMarkdownHtml(entry.body))}`,
        false,
        entry.id
      )
    )
  )}`
}

function absoluteUpdateHtml(body: string): string {
  return renderUpdateMarkdownHtml(body)
    .replaceAll('href="/', `href="${SITE_URL}/`)
    .replaceAll('href="#', `href="${SITE_URL}/updates/#`)
}

export function renderUpdatesFeed(): string {
  const updates = editorialEntries()
  const lastBuildDate = updates[0]
    ? `\n    <lastBuildDate>${new Date(updates[0].publishedAt).toUTCString()}</lastBuildDate>`
    : ''
  const items = updates
    .map((entry) => {
      const permalink = `${SITE_URL}/updates/#${encodeURIComponent(entry.id)}`
      return `    <item>
      <title>${escapeHtml(entry.title)}</title>
      <link>${escapeHtml(permalink)}</link>
      <guid isPermaLink="true">${escapeHtml(permalink)}</guid>
      <pubDate>${new Date(entry.publishedAt).toUTCString()}</pubDate>
      <category>${updateKindLabel(entry.kind)}</category>
      <description>${escapeHtml(absoluteUpdateHtml(entry.body))}</description>
    </item>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Elixir Drop Updates</title>
    <link>${SITE_URL}/updates/</link>
    <description>New Elixir Drop player features, season results, and messages from POAP KINGS.</description>
    <language>en-us</language>${lastBuildDate}
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`
}

const ABOUT_BODY = pageSections([
  section(
    'Built for fast reads',
    `${paragraph(
      'Elixir Drop is a free browser game for learning Clash Royale card elixir costs through fast, replayable games.'
    )}${paragraph(
      'Explore the <a href="/games/">six game modes</a>, follow the <a href="/learn-elixir-costs/">learning guide</a>, or check a card in the <a href="/elixir-costs/">elixir-cost reference</a>.'
    )}`
  ),
  section(
    'Play, improve, compete',
    `${paragraph(
      'Every mode works without an account. Sign in when you want to save progress, <a href="/badges/">earn badge milestones</a>, and post eligible ranked scores to seasonal and all-time leaderboards.'
    )}${paragraph(
      'Leading results may rank provisionally while <a href="/fair-play/">Fair Play</a> reviews them. The review process is designed to protect honest competition without treating an automated signal as a verdict.'
    )}`
  ),
  section(
    'Help shape Drop',
    paragraph(
      `Share feedback and strategies in the <a href="/discord/">Elixir Drop Discord</a>. For private questions, privacy requests, or help with a result, email <a href="mailto:${CONTACT}">${CONTACT}</a>. Sign-in magic links come from elixir@poapkings.com.`
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
    'No. You can play every mode as a guest. Signing in with your email saves scores, levels, badge progress, and leaderboard placement across devices.'
  ],
  [
    'How does sign-in work?',
    'There is no password. Enter your email and Drop sends a one-tap magic link from elixir@poapkings.com.'
  ],
  [
    'Are the elixir costs official?',
    'Card costs mirror the live Clash Royale card set. When Supercell rebalances a card, Drop updates its catalog. The current catalog is available on the Elixir Costs page.'
  ],
  [
    'What counts for the leaderboards?',
    'Signed-in online scores from ranked modes are eligible for season and all-time boards. Guest, Practice, and offline runs never rank. Leading or technically unusual results may rank provisionally while Fair Play reviews them.'
  ],
  [
    'What do the Fair Play seals mean?',
    'Most games are never reviewed and carry no seal. Awaiting means a referee is checking the run while it ranks provisionally. Cleared means a referee checked that exact run and it remains eligible. Excluded means the run leaves the board. Automatic checks start review but never decide it.'
  ],
  [
    'How do badges work?',
    'Each public badge is a ladder with several milestones. Stronger milestones change its medallion tier. A small set of hidden badges keeps its identity and requirement secret until earned.'
  ],
  [
    'How do I contact Drop or dispute a run?',
    `Email <a href="mailto:${CONTACT}">${CONTACT}</a> for private questions, privacy requests, or a Fair Play re-review. Include the run tag shown in your game history when asking about a result. General feedback is also welcome in the <a href="/discord/">Elixir Drop Discord</a>.`
  ],
  [
    'Is Elixir Drop made by Supercell?',
    'No. It is a fan-made trainer run by POAP KINGS and is not affiliated with or endorsed by Supercell.'
  ],
  [
    'How do I set up the game on my phone?',
    'Open Game Setup and follow the iPhone or Android steps. Adding Drop to your home screen removes browser bars, gives you a one-tap launch icon, and prepares the game for offline play.'
  ]
] as const

const FAQ_BODY = pageSections(FAQ_ITEMS.map(([question, answer]) => section(question, paragraph(answer))))

const FAIR_PLAY_BODY = `<p class="static-intro">Drop is open source, and learning how it works is welcome. Ranked results still have one simple requirement: a person must deliberately choose every answer through the game&rsquo;s controls.</p>
${pageSections([
  section(
    'Play as a person',
    paragraph(
      'Scripts, bots, automatic answer selection, direct API play, replayed requests, and falsified timing evidence are not eligible for rankings. Built-in settings such as Reduce motion and Enhance effects—and ordinary accessibility tools—are allowed when the player still chooses each answer.'
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
    'Sharing a run',
    `${paragraph(
      'Sharing a run mints a unique link for that share, and Drop counts how many distinct visitors open it so a share badge can credit real reach rather than repeat taps.'
    )}${paragraph(
      'Drop counts opens per link and does not learn who opened one. An open is matched to earlier opens of the same link through a one-way, salted fingerprint of the request; no raw IP address or full browser user-agent is stored. Opens from your own device are not counted, and credit per link stops at a fixed cap, so one lucky link cannot clear a ladder.'
    )}`
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
    'Sharing a run',
    `${paragraph(
      'Sharing a run mints a unique link for that share. Drop counts how many distinct visitors open each link, so a share badge can credit the reach it earned. It does not learn who opened a link: an open is matched to earlier opens of the same link through a one-way, salted fingerprint of the request, the same way Fair Play signals work. Drop does not store the raw IP address or full browser user-agent for this, opens from your own device are not counted, and credit per link stops at a fixed cap.'
    )}${paragraph(
      'A shared link shows only what your public profile already shows: your Drop name, favorite card, arena, the mode, and the score. Deleting your account deletes your shared links along with everything else.'
    )}`
  ),
  section(
    'Retention and deletion',
    `${paragraph(
      'Magic links and signed run challenges expire quickly. Application logs are retained for 30 days. Your active profile and scores remain until you delete the account from your player profile.'
    )}${paragraph(
      'Account deletion removes your email, Drop identity, saved tag association, game history, leaderboard entries, and any links you shared from the active database and removes the matching Buttondown player-update subscription. Anonymous aggregate Trophy Road totals remain. Encrypted recovery backups and private operator event history may take longer to age out.'
    )}`
  ),
  section('Questions', paragraph(`Email <a href="mailto:${CONTACT}?subject=Elixir%20Drop%20question">${CONTACT}</a>.`))
])}<p class="static-updated">Last updated August 19, 2026.</p>`

const INSTALL_BODY = `<p class="static-intro">Set up Elixir Drop for a cleaner, full-screen experience, one-tap launching, and offline play when your connection is unavailable.</p>
${pageSections([
  section(
    'iPhone · Safari',
    '<ol><li>Open Elixir Drop in Safari while you are online.</li><li>Tap the Share button in the Safari toolbar.</li><li>Scroll and choose <strong>Add to Home Screen</strong>.</li><li>Tap Add. Launch Drop once from the new home-screen icon so its game files and card art are ready.</li></ol>'
  ),
  section(
    'Android · Chrome',
    '<ol><li>Open Elixir Drop in Chrome while you are online.</li><li>Tap the menu in the top-right of Chrome.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Confirm, then launch Drop once from the new icon so its game files and card art are ready.</li></ol>'
  ),
  section(
    'Desktop controls',
    `${paragraph(
      'Every game plays directly on desktop. For elixir costs, keep both hands on the home row; the number row remains an alias.'
    )}<div class="static-keymap" role="table" aria-label="Desktop elixir cost keyboard mapping"><div role="row"><span role="rowheader">Cost</span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><kbd>5</kbd><kbd>6</kbd><kbd>7</kbd><kbd>8</kbd><kbd>9</kbd></div><div role="row"><span role="rowheader">Key</span><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd><kbd>G</kbd><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd><kbd>;</kbd></div></div>${paragraph(
      '<strong>Space</strong> plays again or takes the screen’s primary action. Higher / Lower uses the arrow keys, <strong>Escape</strong> focuses quit before a second press confirms it, and <strong>?</strong> opens the controls guide.'
    )}`
  ),
  section(
    'Why use Game Setup?',
    '<ul><li>A one-tap home-screen icon</li><li>More room to play without normal browser bars</li><li>All six games available when player services or your connection are unavailable</li></ul>'
  ),
  section(
    'What offline play means',
    `${paragraph(
      'Offline runs are session-only. They do not save a personal best, season best, account history, Player XP, badges, daily activity, global game count, or leaderboard entry, and they are never uploaded later.'
    )}${paragraph(
      'Open the installed game while online before you need it offline. The app reports whether the card catalog, card art, and service worker are ready in App Info.'
    )}`,
    true
  )
])}`

const MODE_DETAILS: Record<
  GameMode,
  { focus: string; format: string; ranked: string; overview: string; choose: string }
> = {
  practice: {
    focus: 'Exact-cost recall',
    format: 'Endless · untimed',
    ranked: 'No',
    overview:
      'Name each card’s cost without a clock. Missed and slower cards return more often, optional hints turn recall into recognition, and the session ends whenever you choose.',
    choose: 'Start here when you are learning the catalog or want a low-pressure warm-up.'
  },
  surge: {
    focus: 'Speed and accuracy',
    format: '15-card sprint',
    ranked: 'Yes · lowest time',
    overview:
      'Race through 15 cards as quickly as possible. Every wrong answer adds two seconds, so clean recall beats frantic guessing.',
    choose: 'Choose Surge for the clearest benchmark of instant cost recall.'
  },
  'higher-lower': {
    focus: 'Relative cost',
    format: '3 lives · tightening clock',
    ranked: 'Yes · most correct',
    overview:
      'Two cards appear with different costs. Tap the more expensive card before the clock closes; a wrong answer or timeout costs one of three lives.',
    choose: 'Choose Higher / Lower to sharpen quick comparisons before exact numbers feel automatic.'
  },
  trade: {
    focus: 'Elixir exchanges',
    format: '10 exchanges',
    ranked: 'Yes · lowest time',
    overview:
      'Read cards from the Blue King side and call the trade from −4 through +4. A wrong answer adds two seconds and reveals a useful cost hint before you try again.',
    choose: 'Choose Trade when you want card costs to become usable match decisions.'
  },
  survival: {
    focus: 'Recall under pressure',
    format: 'Sudden death',
    ranked: 'Yes · longest streak',
    overview:
      'Cards come from the full catalog without repeats while the clock keeps tightening. One miss or timeout ends the run; clearing the catalog is a win.',
    choose: 'Choose Survival when you want a high-stakes test of consistency.'
  },
  rain: {
    focus: 'Fast visual recognition',
    format: '3 lives · accelerating',
    ranked: 'Yes · most cleared',
    overview:
      'Cards fall from the sky while you clear each one by cost. The pace accelerates, and a landed card or wrong answer costs one of three lives.',
    choose: 'Choose Rain for the most arcade-like way to build fast visual recall.'
  }
}

function gamesBody(): string {
  const rows = GAMES.map((game) => {
    const detail = MODE_DETAILS[game.mode]
    return `<tr><th scope="row"><a href="#${game.mode}">${escapeHtml(game.name)}</a></th><td>${escapeHtml(
      detail.focus
    )}</td><td>${escapeHtml(detail.format)}</td><td>${escapeHtml(detail.ranked)}</td></tr>`
  }).join('')
  const modeSections = GAMES.map((game) => {
    const detail = MODE_DETAILS[game.mode]
    return section(
      game.name,
      `<div class="static-mode"><img src="${game.art}" width="88" height="88" alt=""><div>${paragraph(
        escapeHtml(detail.overview)
      )}${paragraph(`<strong>Best for:</strong> ${escapeHtml(detail.choose)}`)}${playLink(
        game.path,
        `Play ${game.name}`,
        `content.games.play-${game.mode}`
      )}</div></div>`,
      false,
      game.mode
    )
  })
  return `<p class="static-intro">Six games train the same Clash Royale skill from different angles: seeing a card and knowing its elixir cost without stopping to calculate.</p>
  <div class="static-table-wrap"><table><caption>Compare Elixir Drop game modes</caption><thead><tr><th>Mode</th><th>Trains</th><th>Format</th><th>Ranked</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${pageSections([
    section(
      'Which mode should I play?',
      `${paragraph(
        'New to the card catalog? Begin with <a href="#practice">Practice</a> to learn exact values at your own pace. Want a clean speed benchmark? Play <a href="#surge">Surge</a>. Use <a href="#higher-lower">Higher / Lower</a> for comparisons, <a href="#trade">Trade</a> for match math, <a href="#survival">Survival</a> for consistency, and <a href="#rain">Rain</a> for an arcade challenge.'
      )}${paragraph(
        'Practice is intentionally unranked. The other five modes have seasonal and all-time leaderboards for signed-in online runs. Read <a href="/fair-play/">Fair Play</a> before competing for a leading result.'
      )}`
    ),
    ...modeSections
  ])}`
}

const LEARN_BODY = `<p class="static-intro">Knowing elixir costs is useful only when the answer arrives fast enough to leave your attention on the match. Elixir Drop turns that knowledge into repeatable recall.</p>
${pageSections([
  section(
    'Why instant recall matters',
    `${paragraph(
      'Every card creates an elixir decision: defend cheaply, accept damage, pressure the other lane, or wait. If you have to calculate a familiar card’s cost, that calculation competes with placement, timing, cycle, and your opponent’s remaining elixir.'
    )}${paragraph(
      'The goal is not trivia. It is to recognize the cost quickly enough that the rest of the match gets more of your attention.'
    )}`
  ),
  section(
    'Recall before recognition',
    `${paragraph(
      '<strong>Recall</strong> means producing a cost from the card alone. <strong>Recognition</strong> means choosing it from visible options. Recognition is a useful bridge, but recall is the skill you need in a live match.'
    )}${paragraph(
      'Practice is adaptive. It begins with recall and offers choices only when you ask for help; missed cards return until they stick.'
    )}${playLink('/practice', 'Start Practice', 'content.learn.play-practice')}`
  ),
  section(
    'Turn costs into elixir trades',
    `${paragraph(
      'Knowing that Fireball costs 4 and Musketeer costs 4 is the foundation. Reading whether an entire exchange leaves you up, down, or even is the next step. Higher / Lower trains quick relative reads; Trade makes you total both sides of an exchange under time pressure.'
    )}${paragraph(
      '<a href="/elixir-costs/">Use the complete elixir-cost reference</a> when you need to check a card, then return to a game so the answer becomes recall rather than lookup.'
    )}${playLink('/trade', 'Practice elixir trades', 'content.learn.play-trade')}`
  ),
  section(
    'A simple training routine',
    '<ol><li><strong>Warm up in Practice.</strong> Play until you have recovered the cards you miss instead of stopping at the first good streak.</li><li><strong>Test exact recall in Surge.</strong> A 15-card run makes improvement easy to compare.</li><li><strong>Change the angle.</strong> Rotate through Higher / Lower, Trade, Survival, and Rain so the knowledge survives different kinds of pressure.</li><li><strong>Review, then repeat.</strong> Use the summary to identify weak costs or cards and return to Practice.</li></ol>'
  ),
  section(
    'Keep the goal useful',
    paragraph(
      'A leaderboard time can make practice fun, but the durable win is faster, calmer match reading. Short, regular sessions are more useful than one exhausting session followed by a long gap.'
    )
  )
])}`

function elixirCostsBody(): string {
  const data = cardData as { version: string; count: number; cards: CardEntry[] }
  const byCost = new Map<number, CardEntry[]>()
  for (const card of data.cards) {
    const bucket = byCost.get(card.elixir) ?? []
    bucket.push(card)
    byCost.set(card.elixir, bucket)
  }
  const groups = [...byCost.entries()]
    .sort(([left], [right]) => left - right)
    .map(([cost, cards]) =>
      section(
        `${cost} elixir`,
        `<ul class="static-card-grid">${cards
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(
            (card) =>
              `<li><strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(titleCase(card.rarity))} · ${escapeHtml(
                titleCase(card.type)
              )}</span></li>`
          )
          .join('')}</ul>`,
        false,
        `cost-${cost}`
      )
    )
  return `<p class="static-intro">A complete reference to the ${data.count} Clash Royale cards currently used by Elixir Drop, grouped by elixir cost. The game catalog was refreshed ${escapeHtml(
    dateLabel(data.version)
  )}.</p>
  <nav class="static-jump" aria-label="Jump to an elixir cost">${[...byCost.keys()]
    .sort((left, right) => left - right)
    .map((cost) => `<a href="#cost-${cost}">${cost}</a>`)
    .join('')}</nav>
  ${pageSections(groups)}
  <p class="static-afterword">Looking up a card answers today’s question. Practicing the catalog makes the answer available during a match. ${playLink(
    '/practice',
    'Practice the card catalog',
    'content.costs.play-practice'
  )}</p>`
}

const BADGE_GROUPS: ReadonlyArray<{ key: BadgeDefinition['group']; title: string; description: string }> = [
  {
    key: 'mode-mastery',
    title: 'Mode Mastery',
    description: 'Volume ladders that grow as you keep playing each mode.'
  },
  { key: 'mode-skill', title: 'Mode Skill', description: 'Personal-best ladders for stronger individual runs.' },
  { key: 'progression', title: 'Progression', description: 'Milestones that span the whole Elixir Drop experience.' },
  {
    key: 'card-knowledge',
    title: 'Card Knowledge',
    description: 'Proof that your recall covers different parts of the card catalog.'
  },
  { key: 'habit', title: 'Habit', description: 'Milestones for returning and building a regular practice habit.' }
]

const BADGE_MODE: Partial<Record<string, GameMode>> = {
  'surge-runner': 'surge',
  clockbreaker: 'surge',
  'bridge-read': 'higher-lower',
  'coin-flip-killer': 'higher-lower',
  'trade-reader': 'trade',
  'sharp-trade': 'trade',
  'last-stand': 'survival',
  unbroken: 'survival',
  stormchaser: 'rain',
  downpour: 'rain',
  reps: 'practice',
  'clean-sweep': 'practice',
  catalog: 'practice',
  spellcaster: 'practice',
  'tower-watch': 'practice',
  'big-spender': 'practice'
}

function formatRung(rung: number, badge: BadgeDefinition): string {
  const value = rung >= 1_000 ? rung.toLocaleString('en-US') : String(rung)
  return badge.unit === 'seconds' ? `${value}s` : value
}

function badgesBody(): string {
  const publicBadges = BADGE_LIST.filter((badge) => !badge.hidden)
  const hiddenCount = BADGE_LIST.length - publicBadges.length
  const groups = BADGE_GROUPS.map((group) => {
    const badges = publicBadges.filter((badge) => badge.group === group.key)
    return section(
      group.title,
      `${paragraph(escapeHtml(group.description))}<div class="static-badge-grid">${badges
        .map((badge) => {
          const mode = BADGE_MODE[badge.slug]
          const game = mode ? GAMES.find((candidate) => candidate.mode === mode) : undefined
          return `<article id="${escapeHtml(badge.slug)}" class="static-badge"><img src="/assets/badges/${escapeHtml(
            badge.slug
          )}-192.png" width="72" height="72" alt=""><div><h3>${escapeHtml(badge.name)}</h3><p>${escapeHtml(
            badge.requirement ?? ''
          )}</p><p class="static-badge__rungs"><strong>Milestones:</strong> ${badge.rungs
            .map((rung) => escapeHtml(formatRung(rung, badge)))
            .join(' · ')}</p>${
            game
              ? `<a href="/#${game.path}" data-tinylytics-event="content.badges.play-${game.mode}">Play ${escapeHtml(
                  game.name
                )} →</a>`
              : ''
          }</div></article>`
        })
        .join('')}</div>`
    )
  })
  return `<p class="static-intro">Every finished game can move a badge ladder. Clear milestones to change a badge from unlit to copper, silver, gold, and finally prismatic.</p>
  ${pageSections([
    section(
      'How badge ladders work',
      `${paragraph(
        'Badges are progress ladders, not one-time checkboxes. Each badge has several meaningful milestones. Your medallion shows the strongest tier you have reached and the exact rung that earned it.'
      )}${paragraph(
        'Badge progress is saved for signed-in online play. Guest and offline runs are playable, but they do not add badge progress.'
      )}`
    ),
    ...groups,
    section(
      `${hiddenCount} hidden badges`,
      '<div class="static-secret"><span aria-hidden="true">?</span><p>Some badges celebrate surprising moments instead of published goals. Their identities and requirements stay concealed until they are earned.</p></div>',
      true
    )
  ])}`
}

const DISCORD_BODY = `<p class="static-intro">The Elixir Drop Discord is the easiest place to compare personal bests, share strategies, suggest improvements, and help shape what comes next.</p>
${pageSections([
  section(
    'Everyone who plays is welcome',
    `${paragraph(
      'You do not need to be a POAP KINGS clan member. Join if you play Elixir Drop, are learning Clash Royale elixir costs, or simply want to follow the game’s development.'
    )}<a class="static-inline-cta" href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer" data-tinylytics-event="content.discord.join">Join the Elixir Drop Discord →</a>`
  ),
  section(
    'Good things to share',
    '<ul><li>Feedback about a mode, screen, or confusing moment</li><li>Ideas for new training approaches</li><li>Personal bests, badge milestones, and learning strategies</li><li>Browser or device details when reporting a bug</li></ul>'
  ),
  section(
    'Keep private matters private',
    paragraph(
      `Do not post email addresses, account details, Fair Play evidence, or other private information in public Discord channels. For privacy requests, sensitive reports, or a result review, email <a href="mailto:${CONTACT}">${CONTACT}</a>.`
    ),
    true
  )
])}`

const PAGES: Record<StaticPageSlug, StaticPage> = {
  games: {
    eyebrow: 'Choose your drill',
    title: 'Elixir Drop Game Modes',
    description:
      'Compare Practice, Surge, Higher / Lower, Trade, Survival, and Rain—six games for learning Clash Royale elixir costs.',
    body: gamesBody(),
    schemaType: 'CollectionPage',
    schemaItems: GAMES.map((game) => ({
      name: game.name,
      url: `${SITE_URL}/games/#${game.mode}`,
      description: game.description
    }))
  },
  'learn-elixir-costs': {
    eyebrow: 'Train the useful skill',
    title: 'Learn Clash Royale Elixir Costs',
    description:
      'Learn why instant elixir-cost recall matters, how recall differs from recognition, and how to build a practical training routine.',
    body: LEARN_BODY
  },
  'elixir-costs': {
    eyebrow: 'Card reference',
    title: 'Clash Royale Elixir Costs',
    description: `Browse all ${(cardData as { count: number }).count} cards used by Elixir Drop, grouped by elixir cost with card type and rarity.`,
    body: elixirCostsBody(),
    schemaType: 'CollectionPage',
    schemaItems: (cardData as { cards: CardEntry[] }).cards.map((card) => ({
      name: card.name,
      url: `${SITE_URL}/elixir-costs/#cost-${card.elixir}`,
      description: `${titleCase(card.rarity)} ${card.type}, ${card.elixir} elixir`
    }))
  },
  badges: {
    eyebrow: 'Milestones that grow',
    title: 'Elixir Drop Badges',
    description:
      'Explore Elixir Drop badge ladders for mode mastery, personal bests, progression, card knowledge, and practice habits.',
    body: badgesBody(),
    schemaType: 'CollectionPage',
    schemaItems: BADGE_LIST.filter((badge) => !badge.hidden).map((badge) => ({
      name: badge.name,
      url: `${SITE_URL}/badges/#${badge.slug}`,
      description: badge.requirement
    }))
  },
  discord: {
    eyebrow: 'Join the players',
    title: 'Elixir Drop Discord',
    description:
      'Join the Elixir Drop Discord to share feedback, strategies, personal bests, badge milestones, ideas, and bug reports.',
    body: DISCORD_BODY
  },
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
  updates: {
    eyebrow: 'From the arena',
    title: 'Elixir Drop Updates',
    description: 'New Elixir Drop player features, season winners, and messages, newest first.',
    body: updatesBody()
  },
  install: {
    eyebrow: 'Full-screen, offline, and desktop play',
    title: 'Elixir Drop Game Setup',
    description: 'Set up Elixir Drop on mobile for full-screen offline play or learn the desktop keyboard controls.',
    body: INSTALL_BODY
  }
}

function pageNav(current: StaticPageSlug): string {
  return PRIMARY_NAV.map(
    ({ slug, label }) => `<a href="/${slug}/"${slug === current ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`
  ).join('')
}

function footerNav(current: StaticPageSlug): string {
  const links: ReadonlyArray<{ slug?: StaticPageSlug; label: string; href: string }> = [
    { slug: 'discord', label: 'Discord', href: '/discord/' },
    { slug: 'updates', label: 'Updates', href: '/updates/' },
    { slug: 'privacy', label: 'Privacy', href: '/privacy/' },
    { label: 'Contact', href: `mailto:${CONTACT}` },
    { label: 'POAP KINGS', href: 'https://poapkings.com/elixir-drop/' }
  ]
  return links
    .map(
      ({ slug, label, href }) =>
        `<a href="${href}"${slug === current ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`
    )
    .join('')
}

function pageSchema(page: StaticPage, canonical: string): string {
  const graph: Record<string, unknown>[] = [
    {
      '@type': page.schemaType ?? 'WebPage',
      '@id': canonical,
      name: page.title,
      url: canonical,
      description: page.description,
      isPartOf: { '@id': `${SITE_URL}/#website` }
    }
  ]
  if (page.schemaItems) {
    graph.push({
      '@type': 'ItemList',
      name: `${page.title} list`,
      numberOfItems: page.schemaItems.length,
      itemListElement: page.schemaItems.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: { '@type': 'Thing', ...item }
      }))
    })
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')
}

export function renderStaticPage(slug: StaticPageSlug): string {
  const page = PAGES[slug]
  const canonical = `${SITE_URL}/${slug}/`
  const schema = pageSchema(page, canonical)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#070610">
  <title>${escapeHtml(page.title)} | Elixir Drop</title>
  <meta name="description" content="${escapeHtml(page.description)}">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" type="application/rss+xml" title="Elixir Drop Updates" href="${SITE_URL}/feed.xml">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Elixir Drop">
  <meta property="og:title" content="${escapeHtml(page.title)} | Elixir Drop">
  <meta property="og:description" content="${escapeHtml(page.description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${SITE_URL}/assets/share/og-default.png">
  <meta property="og:image:alt" content="Elixir Drop">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(page.title)} | Elixir Drop">
  <meta name="twitter:description" content="${escapeHtml(page.description)}">
  <meta name="twitter:image" content="${SITE_URL}/assets/share/og-default.png">
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
      <nav class="static-footer__nav" aria-label="More about Elixir Drop">${footerNav(slug)}</nav>
      <p>${POLICY_NOTICE}</p>
    </div>
  </footer>
  <script defer src="https://tinylytics.app/embed/JjqvUeyEnrPM1f_iXrbU/min.js?events&amp;beacon"></script>
</body>
</html>\n`
}
