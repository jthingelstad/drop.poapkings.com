# Elixir Drop — Specification v6

**A Clash Royale elixir-cost learning game, run by POAP KINGS.**

Handoff-ready spec for Claude Code. Elixir Drop is a **self-contained** static
app: it sources card facts from the official Clash Royale API via its own
periodically-refreshed, committed snapshot, inherits the POAP KINGS *look* by
vendoring tokens/fonts into this repo, uses the Elixir mascot as in-game host,
and treats recruitment as a designed funnel. A small set of games share one
engine; the flagship is a speed mode (**Surge**) that produces one clean,
shareable number. v1 is static + localStorage; a clean seam is left for a v2 API.

> **Boundary:** Elixir Drop has **no intermingled connections** to the
> `poapkings.com` site or to the Elixir bot's data (Discord / SQLite). It does
> not share a dataset, analytics property, or runtime dependency with them. The
> only upstream is the CR API, via this repo's own refresh. The only outbound
> ties are hyperlinks (clan invite, Discord) for recruiting.

---

## 0. Name — DECIDED

- **Game:** **Elixir Drop**
- **URL:** `drop.poapkings.com`
- **Why it fits:** ties to the Elixir mascot *and* to the literal UI motif — the
  purple teardrop already exists in the POAP KINGS CSS as `.pl-elixir__drop` and
  becomes the game's signature animated element (it pops on every correct answer).
  "Drop" also reads as *drop a card* / *drop in a guess*.

*Considered and set aside: Pip, Surge, Drip, Splash. `Surge` is retained as the
name of the flagship speed **mode** (see §4.2).*

---

## 1. Product Overview

- **Name:** Elixir Drop
- **URL:** `drop.poapkings.com`
- **Owner:** POAP KINGS (clan tag `#J2RGCRVG`)
- **Primary goal:** Build fast, accurate intuition for Clash Royale card
  elixir costs and the elixir economy.
- **Secondary goal:** Funnel engaged players toward joining POAP KINGS.
- **Host / mascot:** **Elixir** (the clan's persona; this repo bundles its own
  copy of the avatar) as in-game coach.
- **Data source of truth:** the official Clash Royale API `/cards` endpoint, via a
  **periodically refreshed, committed snapshot** owned by this repo (see §3). The
  running game never touches the API.

**Non-goals (v1):** no accounts, no backend game state, no server leaderboard,
no multiplayer, no connection to the Elixir bot's stores or the clan website.
All personalization is local. v2 may add an API + login + a real cross-player
Surge leaderboard.

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Preact | Matches Thingy; tiny runtime |
| State | `@preact/signals` | Reactive game + timer state |
| Build | Vite | Static `dist/` output |
| Routing | hash-based (or `wouter`) | SPA, no server routes |
| Styling | POAP KINGS design tokens + fonts **vendored into this repo** (§8) | No runtime link to the clan site |
| Persistence | localStorage via one typed wrapper (`storage.js`) | Swappable for API later |
| Analytics | Tinylytics — Elixir Drop's own property `JjqvUeyEnrPM1f_iXrbU` | Same technique, separate metrics (§7) |
| Hosting | **GitHub Pages**, custom domain `drop.poapkings.com` | Actions build + deploy on push |
| Card data | committed `cards.json`, refreshed by cron/agent on a managed host | See §3 |
| Card art | hotlink the CR CDN (`api-assets.clashroyale.com`) + preload | Mirror is a later flag (§3) |

**Critical seam:** every read/write of player progress goes through a single
`storage.js` module (`getStats`, `saveResult`, `getRecords`, `getProfile`, …).
v2 replaces the localStorage body with `fetch` calls without touching game
logic. Document this boundary in code.

**Timing note:** Surge needs an honest clock. Use `performance.now()` for all
elapsed-time math (monotonic, immune to wall-clock changes), not `Date.now()`.

---

## 3. Card Data — Self-Hosted Snapshot, Refreshed on a Managed Host

All card facts originate from `GET https://api.clashroyale.com/v1/cards`, but the
**running game and any CI never call the API.** Two hard constraints on the CR
developer token compound:

1. **CORS** — the API cannot be called from a browser.
2. **IP allowlist** — the token only works from a registered IP. CI runners use
   dynamic IPs, so a GitHub Action / CI fetch is **also impossible.**

So the data is refreshed out-of-band, on infrastructure you control, and the
result is **committed to this repo**.

### Refresh model
- This repo is checked out on a **host Jamie manages**, whose IP is registered
  with the CR developer token.
- The CR token lives in **`.env` in the repo working dir** (`.env` is
  **gitignored**; commit a `.env.example` template). The host uses its own key.
- A **cron job or agent** on that host periodically runs the refresh script.
- The script is **idempotent**: it fetches, normalizes, diffs against the
  committed `cards.json`, and **only commits + pushes when the diff is non-empty.**
  A push triggers **GitHub Actions to build the Vite app and deploy to Pages**.
  No change → no-op, so cron never churns deploys.

- **The CR token is never in CI.** The Pages build only reads the committed
  `cards.json`; only the managed host (with the allowlisted IP + `.env` key) ever
  calls the API. The cron host needs git **push credentials** (deploy key or a
  fine-scoped PAT) to commit `cards.json`.

### `scripts/refresh-cards.mjs`
1. Read `CR_API_TOKEN` from `.env` (e.g. via `dotenv`).
2. `GET /cards` (Bearer auth).
3. **Normalize** per the rules below → candidate `cards.json`.
4. **Diff** vs the committed file; print a changelog (new cards, changed
   `elixirCost`, removed cards).
5. If changed: write `src/data/cards.json`, then `git add/commit/push`
   (commit message includes the changelog summary). If unchanged: exit 0, no commit.
6. **Image mode flag** (`MIRROR_IMAGES=false` default): when `false`, `cards.json`
   stores the CR CDN URL and the game hotlinks it. When `true`, the script also
   downloads each `iconUrls.medium` to `public/cards/{id}.png` and rewrites `icon`
   to the local path. Flipping the flag later requires no game-code changes.

> Can also be run by hand on the same host at any time; cron is just the default
> trigger. Manual runs are how you push a refresh immediately after a Supercell update.

### `/cards` facts the script relies on (per cr-agent-api-docs)
- Returns an `Items` object with two arrays:
  - `items` — 121 standard cards (troops, spells, buildings), each with `elixirCost`.
  - `supportItems` — 4 Tower Troops. **No `elixirCost`.**
- Standard card shape: `{ name, id, maxLevel, maxEvolutionLevel?, elixirCost, iconUrls{ medium, heroMedium?, evolutionMedium? }, rarity }`.
- Pagination params (`limit`/`after`/`before`) are **ignored** — one call returns the full catalog.
- ID ranges encode type: `26000xxx` troops · `27000xxx` buildings · `28000xxx` spells · `159000xxx` Tower Troops.
- `iconUrls.medium` is always present; art is hosted at `api-assets.clashroyale.com`.

### Normalization (script output)
For each entry in `items` with an `elixirCost`, emit:

```json
{
  "id": 26000000,
  "name": "Knight",
  "elixir": 3,
  "rarity": "common",
  "type": "troop",            // derived from id range: 26→troop, 27→building, 28→spell
  "evo": false,               // maxEvolutionLevel === 1 || 3
  "hero": false,              // maxEvolutionLevel === 2 || 3
  "icon": "https://api-assets.clashroyale.com/cards/300/....png"  // CDN by default; local path if MIRROR_IMAGES
}
```

Rules:
- **Exclude `supportItems`** (Tower Troops) — they have no `elixirCost`.
- `type` from id range (above). `evo`/`hero` from `maxEvolutionLevel` per the
  docs' inferred mapping (1 → Evo, 2 → Hero, 3 → both).
- Top-level `"version"` (snapshot date) and `"count"` for cache-busting + a
  "card data current as of…" line.

### Card images — hotlink the CR CDN (recommended), mirror optional
Default to **hotlinking** `api-assets.clashroyale.com` and **preloading** for the
speed mode. This is independent of POAP KINGS — it's direct fan-policy use of
Supercell's CDN, the same use the clan site independently makes.

- **Preload** to keep Surge jank-free: the sprint's 15 cards are chosen before the
  timer starts, so preload them in the "Get ready" beat (`new Image().src` or
  `<link rel="preload" as="image">`). 121 medium PNGs cache trivially; subsequent
  cards are instant.
- **Text-chip fallback** if an icon fails to load (card name on a purple plate) so
  the game never breaks on a missing/blocked asset.
- **Revisit mirroring only if** Supercell adds referrer checks or the CDN proves
  flaky. The `MIRROR_IMAGES` flag makes that switch trivial — no game-code change.

### IP / fan policy
Use card art under Supercell's Fan Content Policy: non-commercial, attributed, no
claim of ownership. Carry a Supercell disclaimer in the footer (mirror the site's
`supercellDisclaimer` wording).

---

## 4. Game Modes

A small set of games share one engine. The app ships core drills plus stretch
modes that exercise speed, comparison, trade arithmetic, and spatial ordering.
New game ideas must work from `cards.json` alone; do not add curated deck
definitions or archetype data.

### 4.1 Practice (untimed — build first as the loop)
A card appears; player picks its cost. No clock, no pressure. Used to learn the
loop, onboard beginners, and grind the SRS weak-card list.

- **Input:** 4-button multiple choice **or** the 1–10 pip keypad (config).
- **Distractors are adjacent costs**, never random. A 4-cost offers {3,4,5,6}
  shuffled. 1-cost shifts up (1/2/3/4); high cards shift down. Forces real
  discrimination and mirrors the in-game ±1-elixir decision space.
- Immediate right/wrong with the elixir-drop animation; Elixir reacts.
- Logs per-card accuracy for weighted sampling (§5).
- **Build this first** — prove the core interaction is fun before timing it.

### 4.2 Surge (the flagship — speed / time attack)
Card shown → global timer running → answer as fast as possible. Produces **one
honest, shareable number.** This is the share + recruit engine.

- **Input: the 1–10 pip keypad, not multiple choice.** At speed, MC gets mashed
  and rewards luck. Tapping the real number tests genuine recall — the point.
- **Format:** a Sprint of **15 cards** (tunable constant `SURGE_SPRINT_LEN`).
  Weighted sampling still biases the 15 toward the player's weak cards. **Preload
  all 15 images before the clock starts.**
- **Flow:**
  - Card appears, timer running (`performance.now()`).
  - **Correct** → elixir-drop animation, instant next card.
  - **Wrong** → red flash, **+2.0s penalty** (`SURGE_PENALTY_MS`), and the card
    **stays** until answered correctly. Penalty compounds naturally on repeated
    misses — self-correcting, anti-mash, no separate "reveal" state.
- **Score = total elapsed (real time + penalties). Lower is better (golf).**
  Headline: `15 cards · 28.6s`.
- **Records:** store `surgeBest` (lowest time). A new PB → Elixir `record` line →
  recruit moment → Tinylytics `record.new`.
- **Summary uses per-card split times:** the insight layer can say
  *"you bleed time on 5–6 cost cards"* — more actionable than accuracy alone.
- **Share line:** *"Surge: 15 cards in 28.6s — drop.poapkings.com."*
- **Reduced motion:** keep the timer; drop the flashy FX (gate like the site does).

**Blitz variant (cheap, optional):** same engine, a 60s count-up — "how many
correct can you clear?" Gives a higher-is-better number too. One flag
(`SURGE_MODE = 'sprint' | 'blitz'`); ship Sprint first.

### 4.3 Higher / Lower
Two cards side by side; pick which costs **more**, or "Equal." Trains relative
intuition — the skill that actually wins elixir trades. Cheap, high pedagogical value.

### 4.4 Trade
You are always **Blue King**; Red is the opponent. Blue plays 1–3 sampled cards,
Red answers with 1–3 sampled cards, and the player guesses the elixir trade from
Blue's perspective.

- **Formula:** `trade = redTotal - blueTotal`. Positive means Red spent more
  elixir than you, so Blue got a positive trade.
- **Input:** signed trade keypad from `-4` through `+4`, with `Even` for zero.
- **Flow:** a wrong guess adds +2.0s, reveals one card's elixir cost, and leaves
  the exchange live until answered correctly.
- **Record:** store `tradeBest` (lowest time).

### 4.5 Shipped stretch modes
- **Blitz** — 60s count-up: how many cards can you clear? Reuses Surge's timed
  keypad flow. Record: `blitzBest`.
- **Survival** — endless timed Quick answers; one wrong or timeout ends the run.
  A sudden-death cousin of Surge for the streak-chasers. Record: `survivalBest`.
- **Speed Ladder** — sort 5 sampled cards from lowest to highest elixir as fast
  as possible. Wrong locks add +2.0s, reveal one persistent cost hint, and leave
  the ladder live; equal-cost cards are accepted in either relative order. Touch
  players can tap a card, then tap a destination. Record: `ladderBest`.

### 4.6 Retired modes
- **Focus** — removed from the active app. It overlapped too heavily with
  Practice; future subset drills should be Practice filters, not a separate tile.
- **Deck Budget** — removed from the active app. The target-average puzzle was
  flat, and fixing it well would require curated real-deck data. That data path is
  intentionally out of scope.
- **No curated decks** — do not add `src/data/decks.json`, archetype definitions,
  or games that require authentic deck construction/coherence.

---

## 5. Learning Engine

### Weighted sampling (SRS-lite)
Per-card stats in localStorage drive selection probability. No full SM-2:

```
weight = BASE
       + missCount        * MISS_WEIGHT      // surface missed cards more
       - recentCorrect    * MASTERY_DECAY    // fade mastered cards
       + recencyPenalty                      // avoid immediate repeats (decays over N draws)
```

Clamp to a floor so mastered cards still resurface. Keep `BASE`, `MISS_WEIGHT`,
`MASTERY_DECAY` in one tunable config object. In Surge, "slow but correct" should
also nudge weight up slightly — speed is part of mastery here.

### Plausible distractors
Adjacent to the truth (see §4.1). Centralize in a `makeChoices(elixir)` helper so
every multiple-choice surface shares the logic. (Surge bypasses this — full keypad.)

### Insight layer (what makes it a *coach*, not a quiz)
At session end, compute from the session's answers:
- accuracy by cost band (1–2 / 3–4 / 5+),
- weakest cards (lowest accuracy),
- in Surge: **slowest cards / slowest band** from split times,
- directional bias ("you tend to **overestimate** spells by ~1 elixir").

Elixir delivers one insight as a spoken line. This is the difference-maker.

---

## 6. Elixir as Host

Elixir is a presentation layer over a **line table** — no LLM inference at
runtime in v1 (zero latency, zero cost, zero risk to the Surge clock).

- **Bundle a copy of the Elixir avatar in this repo's `/assets`** (it's the clan's
  mascot, owned by you). Do **not** hotlink poapkings.com — Elixir Drop ships its
  own asset. 2–3 expression states (neutral / hype / unimpressed) for cheap personality.
- Voice: dry, a little cocky, never mean — consistent with the clan's Elixir
  persona. (Reuse the *persona*, not any runtime connection.)

```json
{
  "correct_fast":   ["Too easy. Next.", "You felt that one."],
  "correct_streak": ["{n} in a row. The clan would notice.", "..."],
  "wrong_close":    ["Off by one. That one pip loses games.", "..."],
  "wrong_far":      ["Not close. Drill this band.", "..."],
  "surge_done":     ["{time}s. {insight}", "..."],
  "record":         ["New best: {time}s. People who read elixir like this win wars →"],
  "recruit":        ["You're reading elixir like a clan member. We have room for that →"],
  "idle":           ["Tap a card. Let's go."]
}
```

- Lines chosen by event type; `{n}`, `{time}`, `{insight}` interpolated.
- **During Surge, keep Elixir quiet** — a between-card line would cost time and
  distract. Save Elixir's reaction for the summary screen.
- **v2 hook:** the line table could later be generated, but v1 stays static and
  self-contained.

---

## 7. Recruitment Funnel + Tinylytics

Recruitment is **moments, not chrome.** Earn attention first, then ask. Surge is
the best trigger surface — a fresh PB is a natural, earned high.

1. **Triggers:** new Surge PB, a completed Practice session at ≥ X% accuracy, or
   (stretch) a Survival run past a threshold.
2. **The ask:** Elixir delivers a `record`/`recruit` line + a single CTA. No
   load-time modal, no nagging.
3. **Destinations (outbound links only — the funnel's whole purpose):**
   - Join clan: `https://link.clashroyale.com/invite/clan/en?tag=J2RGCRVG&token=dtw94pzg`
   - Discord: `https://discord.gg/kBD62fYHWx`
   - The clan is often **full** → mirror the site's "JOIN vs WAIT" pattern; lead
     with Discord when full.
4. **Soft persistent path:** quiet "Run by POAP KINGS" footer link, always present.
5. **Shareable result:** the Surge summary generates a copyable line
   (*"Surge: 15 cards in 28.6s — drop.poapkings.com"*). Pure text, no backend.

### Tinylytics — Elixir Drop's OWN property
Reuse the *technique* the clan site uses, with a **separate Tinylytics site ID**
so metrics and the star count stay this game's own (no intermingling).

- **Property created.** Site ID `JjqvUeyEnrPM1f_iXrbU` (integer `3445`, used only
  for the API / webmention endpoint). Embed in `<head>`:
  ```html
  <script src="https://tinylytics.app/embed/JjqvUeyEnrPM1f_iXrbU.js?hits&kudos=%F0%9F%91%8F&countries&events&beacon" defer></script>
  ```
- **Hits → Stars:** adopt the site's delightful `.starcount` pop/spark animation,
  driven by *this game's* hit count — a self-contained "Drop Stars" counter, not
  the clan's stars.
- **Custom events** via `data-tinylytics-event="…"`:
  `game.start`, `mode.practice`, `mode.surge`, `mode.higherlower`,
  `mode.trade`, `mode.blitz`, `mode.survival`, `mode.ladder`, `surge.complete`,
  `ladder.complete`, `trade.complete`, `record.new`, `recruit.shown`,
  `recruit.join`, `recruit.discord`, `result.share`.
- **Kudos** as a lightweight "this was fun" signal on the summary screen.
- Local funnel mirror in localStorage so v2 analytics has history.
- **v2:** a real cross-player Surge leaderboard is the obvious API upgrade.

---

## 8. Design System — Vendor the POAP KINGS Look (no runtime link)

**Copy** the design tokens, fonts, and the component CSS you reuse from
`poapkings.com/src/styles.css` **into this repo's own stylesheet + assets.** Match
the look; keep zero runtime dependency on the clan site.

**Fonts:** copy in `Clash` (display `.otf`s), `Supercell Magic` fallback, Inter body.

**Core tokens (CSS custom properties):**
```
--bg0:#070610; --bg1:#0B0920;        /* near-black purple base */
--ink:#F7F4FF; --muted:#C8C1E6;
--purple:#6D28D9; --purple2:#3B1D7A;
--gold:#F5C84C;   --gold2:#C98C10;
--lavender:#D7C8FF;
/* radii: --r-sm 10 / --r-md 14 / --r-lg 20 ; shadow: 0 18px 60px rgba(0,0,0,.55) */
```
Background is the layered radial-purple + gold glow gradient (copy `body` rule).

**Components to copy / mirror into this repo:**
- **Elixir drop** — `.pl-elixir__drop` (purple teardrop via `clip-path`). The
  signature animated element and namesake; pop it on every correct answer.
- **Pip keypad (new)** — a 1–10 row of large tap targets built from drop motifs.
  Big, thumb-friendly, fast. The one genuinely new component.
- **Buttons** — `.btn`, `.btn--gold`, `.btn--purple`, `.btn--ghost`, `.btn--sm`
  (`.btn--gold` for primary CTAs).
- **Pills** — `.pill`, `.pill--gold`, `.pill--purple`, `.pill--live` for mode chips.
- **Player-card frame** — `.pcard` (gold-edged, purple interior, container-query
  fluid internals) to frame the card-being-quizzed.
- **Star counter** — `.starcount` + its pop/spark/`+1` animation (wired to *this*
  game's Tinylytics, §7).
- **Eyebrows / headings** — `.eyebrow`, `.h-display`, `.h1/.h2/.h3`, `.lede`.
- **Footer** — `.site-foot` grid + Supercell disclaimer line.
- **Reduced motion** — honor `prefers-reduced-motion` (gate the drop & streak FX;
  Surge keeps the timer + red-flash either way).

**Layout:** content width `--col: 1120px`; calm centered column. Energy comes from
card art, the drop animation, the Surge timer, and Elixir's reactions — not clutter.

---

## 9. Data & Storage Schemas

### `cards.json` (committed snapshot, refreshed per §3)
```json
{
  "version": "2026-06-13",
  "count": 121,
  "cards": [ /* normalized card objects per §3 */ ]
}
```

### localStorage (versioned key prefix)
```
elixirdrop:profile    → { createdAt, nickname?, totalSessions }
elixirdrop:cardStats  → { [id]: { seen, correct, missStreak, lastSeen, avgMs? } }
elixirdrop:records    → { surgeBest, longestStreak, bestAccuracy, blitzBest,
                           survivalBest, ladderBest, tradeBest }
elixirdrop:funnel     → { recruitShown, recruitJoin, recruitDiscord, shares }
elixirdrop:settings   → { inputStyle, sound, reducedMotion? }
```
Versioned prefix makes a future schema migration detectable. All access via
`storage.js`. `avgMs` on cardStats supports the Surge "slowest cards" insight.

### Config / env
```
# .env (gitignored; commit .env.example)
CR_API_TOKEN=...                 # used ONLY by scripts/refresh-cards.mjs on the managed host
MIRROR_IMAGES=false              # refresh script: hotlink (false) vs download (true)

# build-time / app config
ELIXIRDROP_TINYLYTICS_ID=JjqvUeyEnrPM1f_iXrbU   # Elixir Drop's own Tinylytics property
```

### Surge tunables (one config object)
```
SURGE_SPRINT_LEN = 15          // cards per Sprint
SURGE_PENALTY_MS = 2000        // added per wrong answer
SURGE_MODE       = 'sprint'    // 'sprint' | 'blitz'
SURGE_BLITZ_MS   = 60000       // Blitz window (if used)
```

---

## 10. Suggested Build Order (for Claude Code)

1. Scaffold Vite + Preact + Signals. Vendor POAP KINGS tokens + fonts into this
   repo's stylesheet/assets. Hash-routing shell + calm centered layout.
   **GitHub Pages setup:** `public/CNAME` = `drop.poapkings.com`; `vite base:'/'`;
   `.github/workflows/deploy.yml` (build + `actions/deploy-pages`, `permissions:
   pages:write, id-token:write`); enable Enforce HTTPS once the cert provisions.
   Wire the Tinylytics embed (§7).
2. `scripts/refresh-cards.mjs` — `.env`-token `/cards` fetch (run on the managed
   host), normalize → `src/data/cards.json`, diff + changelog, commit-on-change,
   `MIRROR_IMAGES` flag. Commit a real snapshot so dev works offline + ships with data.
3. Card loader + `makeChoices(elixir)` adjacent-distractor helper + image preloader.
4. **Practice** loop with the `.pl-elixir__drop` animation on correct answers.
   *Make it fun before timing it.*
5. `storage.js` + `cardStats`; wire weighted sampling (§5).
6. **Pip keypad** component (1–10 drop buttons).
7. **Surge** mode: preload sprint images, `performance.now()` timer,
   +penalty-on-wrong, card-stays logic, split-time capture, golf scoring, `surgeBest`.
8. Elixir host: bundled avatar states + line table + event selection (quiet during Surge).
9. Session/Surge summary + insight layer (incl. slowest-card insight).
10. **Higher / Lower** mode.
11. **Trade** mode: Blue perspective, signed trade keypad, cost hints.
12. Tinylytics wiring (own ID): star counter, custom events, kudos, share line (§7).
13. Recruitment funnel (PB trigger, CTA, full-clan JOIN/WAIT mirror, footer).
14. Stretch modes: Blitz, Survival, Speed Ladder.
15. Supercell disclaimer, polish, sound + reduced-motion toggles, responsive.

---

## 11. Open Questions

1. **Managed host** — confirm the box that holds the checkout + `.env` + cron
   (its IP must be registered with the CR token).
2. *(Resolved)* **Deploy trigger** — GitHub Pages. Managed host commits `cards.json`
   → push → GitHub Actions builds + deploys. CR token stays off CI.
3. **Surge scoring** — golf time (recommended) vs points (base + speed bonus −
   penalty)? Ship Sprint only, or Sprint + Blitz?
4. **Practice input default** — 4-button MC vs the pip keypad (or offer both and
   remember the choice)?
5. **Evolutions** — quiz on base elixir only (recommended), or surface Evo/Hero
   as flavor on the card without affecting the answer?
6. **Elixir voice** — confirm "dry, a little cocky"; any clan in-jokes /
   catchphrases to seed into the line table?

*(Resolved since v4: name = Elixir Drop; standalone; token in `.env`, not 1Password;
images hotlink the CR CDN with a mirror flag. Since v5: hosting = GitHub Pages at
`drop.poapkings.com`; deploy via Actions on push (token never in CI); Tinylytics
property `JjqvUeyEnrPM1f_iXrbU` created.)*

## 12. v1 Readiness Checklist

**Done**
- [x] Subdomain `drop.poapkings.com` → GitHub Pages (DNS)
- [x] Tinylytics property `JjqvUeyEnrPM1f_iXrbU` (int `3445`)
- [x] CR API access model + refresh design decided (§3)
- [x] Design system source identified (vendor from clan `styles.css`)

**Infra / deploy**
- [ ] Create repo; scaffold Vite + Preact + Signals
- [ ] `public/CNAME` = `drop.poapkings.com`; `vite base:'/'`
- [ ] `.github/workflows/deploy.yml` (build + Pages deploy)
- [ ] Tinylytics embed in `<head>` (§7 snippet)
- [ ] `.env.example` committed; `.env` gitignored
- [ ] Cron host push credentials (deploy key or scoped PAT)

**Data**
- [ ] `scripts/refresh-cards.mjs` (normalize, diff/changelog, commit-on-change, `MIRROR_IMAGES`)
- [ ] First `cards.json` (one token'd run on the managed host)
- [ ] Cron entry on the managed host

**Assets / content**
- [ ] Elixir avatar bundled in `/assets` (single image fine for v1; expressions optional)
- [ ] Fonts + tokens vendored into this repo
- [ ] Elixir line table written (in voice)
- [ ] Favicon + OG / share image for `drop.poapkings.com`
- [ ] Supercell disclaimer string in footer

**The game (build order §10, 4–14)**
- [ ] Practice loop + elixir-drop animation
- [ ] `storage.js` + weighted sampling
- [ ] Pip keypad
- [ ] Surge (preload, timer, penalty, golf scoring, PB)
- [ ] Elixir host (avatar + line table)
- [ ] Summary + insight layer
- [ ] Higher / Lower
- [ ] Trade
- [ ] Recruitment funnel + footer
- [ ] Blitz / Survival / Speed Ladder
- [ ] Polish, sound + reduced-motion toggles, responsive

**Decisions to confirm (§11)**
- [ ] Surge scoring: golf time (rec) vs points; Sprint only vs + Blitz
- [ ] Practice input default: MC vs pip keypad
- [ ] Evolutions: base elixir only (rec) vs Evo/Hero flavor
- [ ] Elixir voice: confirm "dry, a little cocky" + any in-jokes

**Only-Jamie items:** managed host + push creds · OG/share image + favicon · the four decisions above.

---

*Unofficial fan project. Card data, names, and artwork © Supercell, used under
Supercell's Fan Content Policy. Not endorsed by Supercell.*
