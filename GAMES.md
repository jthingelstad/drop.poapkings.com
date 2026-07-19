# GAMES.md - Elixir Drop

This is the canonical games catalog: what ships, what is retired, and what is
only an idea. Mechanic-level game decisions live here. Read it before adding or
reworking a mode.

Doc map:

- **`README.md`** is the public overview and local-development entry point.
- **`SPEC.md`** is the current implementation spec and product constraints.
- **`CLAUDE.md`** is the agent working guide.

Shipped state as of July 19, 2026: **five playable modes** — Surge, Practice,
Higher / Lower, Trade, and Survival. **Practice is true practice**: runs
record to history and earn Player XP (activity, like every mode) but are
unranked and have no leaderboard tab. Player XP is a per-player activity score
(one point per question practiced, right or wrong) that drives the arena;
leaderboards rank on speed. **Daily Ladder is not shipped and should not be
built without a fresh product decision.**

Every game shares one engine and the same shared paths: cards come from
`packages/game-data/cards.json`, local learning progress goes through
`apps/web/src/lib/storage.ts`, card selection comes from the signed server
challenge (created in `services/api/src/scoring.ts`, resolved client-side by
`apps/web/src/lib/game-challenge-content.ts`), elixir multiple-choice
distractors through `apps/web/src/lib/choices.ts`, and card presentation through
`apps/web/src/lib/card-rendering.ts` plus
`apps/web/src/components/CardChrome.tsx`. Completed games submit a
mode-specific transcript through `apps/web/src/lib/use-game-run.ts`.

**Card pool and ranking:** every new run deals from the complete canonical card
catalog and ranks on its seasonal leaderboard. Linked Clash Royale collections
remain available on player profiles but do not affect game card selection.
Historical `ranked: false` runs remain readable for compatibility only.

Card art and names should follow the shared rendering reference in
`docs/card-rendering.md`. New modes should use `CardArt`, `CardName`, and
`ElixirCostBadge` instead of inventing another card frame.

**Current product constraint:** do not add curated deck definitions. No
`decks.json`, archetype list, synergy model, or "real deck" dependency. That path
is a maintenance rabbit hole and makes small games expensive. New games should use
only the committed card facts already in `cards.json`: name, elixir, rarity, type,
and art.

---

## Shipped games

### Flagship

**Surge** — `/surge` · `apps/web/src/modes/surge/`
A 15-card speed sprint, scored as golf time: elapsed time plus penalties, lower
wins. A wrong answer adds +2.0s (flashed in the HUD) and the card stays until
correct, with a higher/lower arrow cue pointing from the latest guess toward
the answer (the penalty already paid for the information). At cards 5 and 10 a
ghost-pace checkpoint shows the delta against the recorded best run. The
sprint's images preload before the timer starts; Elixir stays silent during
the run and reacts on the summary. Produces one clean, shareable number.

- Input: pip keypad.
- Record: `surgeBest` (lowest time).

### Core drills

**Practice** — `/practice` · `apps/web/src/modes/practice/`
Untimed. A card appears; name its cost. The signed challenge deals a round of
15 from the complete canonical catalog, with end-early, closing in the shared
summary + insights. **Unranked by design** — runs are created `ranked: false`
server-side, never write a leaderboard entry, and Practice has no leaderboard
tab. Local bests still track for self-paced improvement.

- Input: pip keypad by default, or 4-button multiple choice, remembered in settings.
- Record: `bestAccuracy` (local only; not a leaderboard).

**Higher / Lower** — `/higher-lower` · `apps/web/src/modes/higher-lower/`
Two cards, costs hidden; **tap the card that costs more elixir**. Endless
streak. Pairs are generated so the two cards **never share an elixir cost**
(server `higherLowerPairs`), so there is always a strictly higher card and no
"equal" option is needed — the whole card is the tap target (no separate
controls; far easier on mobile). Each round runs a **shrinking response clock**:
5s to read the opening pair, 250ms less every round it survives, down to a 2s
floor (`higherLowerWindowMs`, shared by the client countdown and the server
scorer with a 250ms boundary tolerance). A wrong tap **or a timeout** ends the
run. Correct advances in 750ms; a miss holds 1.4s and resets the streak. Trains
the relative read that wins elixir trades.

- Record: `longestStreak`.

**Trade** — `/trade` · `apps/web/src/modes/trade/`
You are always Blue King; Red is the opponent. Blue plays 1–3 dealt cards and
Red answers with 1–3 dealt cards across an 8-exchange sprint that ramps from
the small boards (1v1, 2v1) to the big ones. Guess your elixir trade from
`-4` through `+4`, where positive means Red spent more elixir than you. A
wrong guess adds +2.0s, reveals one persistent card-cost hint for that
exchange, and leaves the exchange live. A solved exchange reveals every cost
and both side sums ("Blue 7 · Red 9 → +2") with a tap-to-continue Next —
readers pay only their own dwell against the clock.

- Input: signed trade keypad (`-4 … Even … +4`).
- Record: `tradeBest` (lowest 8-exchange time).

### Tension

**Survival** — `/survival` · `apps/web/src/modes/survival/`
Sudden death. The per-card clock starts at 5s and keeps tightening on a
hyperbolic curve — dropping below 2s around a 40 streak and toward an 800ms
ultimate ceiling — so it never flattens and always pressures a deep run (one
shared curve, `survivalWindowMs`, enforced server-side). One wrong answer _or_ a
timeout ends the run, revealing the missed card's cost; hiding the tab ends
the run with the streak intact. The deck is **every card once** (no repeats), so
clearing it is a **WIN** (max streak ≈ the catalog, ~120). The leaderboard ranks
on **streak count, then fastest cumulative time** (`survivalTimeMs` → the sort
key's tiebreak), so once everyone can clear the deck it becomes a speedrun.

- Record: `survivalBest` (streak). Cumulative time is the leaderboard tiebreak.

### Easter egg: "Elixir Rain" screensaver

Tap the ELIXIR DROP hero logo five times quickly (1.5s per tap), or leave the
Home screen idle for two minutes, and the site dims into an ambient WebGL
scene: a fresh random cast of ~24 cards drifts down through elixir droplets in
three parallax layers, occasionally flipping into other cards, with the
mascot gliding through every so often. Any tap or key exits. It never triggers
on a gameplay route, pauses while the tab is hidden, and under reduced motion
it simply does not exist. Deliberate discovery fires the `egg.screensaver`
analytics event; idle attract is untracked. Purely cosmetic — no scores, no
records, no server involvement.

### Shared active-play chrome

Timed active states use the `game-run` layout: compact header, no footer, and no
star counter while the player is actively timed. Keep controls visible on mobile
and guard against horizontal overflow in e2e tests when adding or changing modes.

---

## Retired games

These are intentionally out of the active app surface. Do not reintroduce them as
separate tiles without a fresh product decision.

**Focus** — removed.
It overlapped too heavily with Practice. If subset drills come back, they should
be a Practice filter or setting, not a separate mode.

**Deck Budget** — removed.
The open-ended target-average puzzle was flat, and making it feel authentically
Clash Royale would require curated deck/archetype data. That is the rabbit hole we
are avoiding.

**Identify, Blitz, Speed Ladder, Endless Ladder, Cost Sweep** — removed.
These five were built and briefly vaulted for a possible post-launch re-release,
then cut entirely (components, libs, server challenge/scoring support, and their
`GameMode` entries are gone). Reviving one is a fresh build, not a flag flip.

---

## Ideas & backlog

From the June 2026 refresh. The active lineup covers speed (Surge/Survival),
comparison (Higher/Lower), cost recall (Practice), and trade math (Trade). The
remaining useful whitespace is **small arithmetic** and **single-card
estimation** — still without deck data.

### Strong non-deck candidates

**Exact Ten** — _arithmetic / set-building_
Show a random pool of visible cards and ask the player to pick a subset totaling
exactly 10 elixir. This should be framed as "fill the bar" or "make 10," not deck
construction. Random pools are acceptable because the mechanic is arithmetic, not
authentic archetype recognition.

**Mystery Cost** — _deduction_
Show a card with the elixir badge hidden and reveal type/rarity/name clues over
time or after wrong guesses. This can borrow from Cardle without becoming a daily
Wordle clone.

### Explicitly deferred

**Daily Ladder** — _shareable spatial puzzle_
A daily seeded set of 5–6 sampled cards to sort from lowest elixir to highest.
It remains a valid idea, but it is **not the next build**. Do not implement it
unless it is re-approved.

### Set aside

- **Curated deck definitions / `decks.json`** — rejected. Too much maintenance and
  too easy to get wrong for real players.
- **Deck-based Make Ten, Price Is Right, Spot the Splash, Daily Deck Ladder** —
  set aside because each depends on authentic decks or archetype coherence.
- **Standalone Focus** — fold into Practice if the need returns.
- **Deck Budget / Average 3.4** — removed with no planned rework.
