# GAMES.md - Elixir Drop

This is the canonical games catalog: what ships, what is retired, and what is
only an idea. Mechanic-level game decisions live here. Read it before adding or
reworking a mode.

**Doc map:** `AGENTS.md` → "Doc map" is the canonical list of every doc and what it
owns.

Shipped state as of July 25, 2026: **six playable modes** — Surge, Practice,
Higher / Lower, Trade, Survival, and Rain. **Practice is a pure drill**: endless,
unranked, no score, no record, and **no Player XP** — it deliberately touches no
competitive or progression surface, which is exactly what lets it run forever.
Player XP is a per-player activity score (one point per question practiced, right
or wrong) that drives the arena and is earned by the other five modes;
leaderboards rank on speed. **Daily Ladder is not shipped and should not be
built without a fresh product decision.**

**Guest play (no account):** every mode is playable signed-out. A guest is dealt
the same server-signed challenge and scored the same way, but the run records
**nothing** — no leaderboard, no all-time, no XP, no history. After a guest run
the summary shows a "Create an account to save this score" nudge (Surge,
Practice, Survival via the shared `Summary`; Trade on its own result screen;
Higher / Lower shows a small persistent "Sign in to save your streak" line).
Local personal bests still track on-device — except Practice, which keeps no
best for anyone. Signing in unlocks recording and ranking.

Every game shares one engine and the same shared paths: cards come from
`packages/game-data/cards.json`, local learning progress goes through
`apps/web/src/lib/storage.ts`, card selection comes from the signed server
challenge (created in `services/api/src/scoring.ts`, resolved client-side by
`apps/web/src/lib/game-challenge-content.ts`), and card presentation through
`apps/web/src/lib/card-rendering.ts` plus
`apps/web/src/components/CardChrome.tsx`. Completed games submit a
mode-specific transcript through `apps/web/src/lib/use-game-run.ts`, which is
also the **only** place a local personal best is written — and only for a run the
server scored, so a rejected run can never leave a "best" on the device. No mode
writes its own record, and Practice has no record to write.

**Card pool and ranking:** every new run deals from the complete canonical card
catalog, and every mode but Practice ranks on its seasonal leaderboard. Linked
Clash Royale collections remain available on player profiles but do not affect
game card selection. Historical `ranked: false` runs remain readable for
compatibility only.
Ranked attempts that score zero still record to history and earn Player XP, but
only a score above zero earns a seasonal or all-time leaderboard entry.

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

**Season competition — the Free Pass.** Surge carries a real prize: the player
ranked first on its seasonal leaderboard at season end wins a Clash Royale
season pass. Two standing consequences:

- **The board does not certify itself.** An automatic integrity flag
  (`automaticReviewReason` / `underReview`) is a review _signal_, never a
  verdict — a flagged run stays on the board until a referee decides otherwise
  (see the visibility filter in `services/api/src/leaderboards.ts`). The
  standing must be referee-reviewed before the pass is awarded; that obligation
  lives in `AGENT-TEAM/fair-play-referee.md`.
- **Attempt volume is legitimate and stays that way.** Best-single-run scoring
  means more attempts yield a better best. That is accepted on purpose:
  grinding Surge _is_ drilling elixir costs, which is the whole product. Do not
  cap ranked attempts or move the board to recent-form ranking to "fix" it.

The winner is picked manually at season end. There is no automated snapshot or
award pipeline, and one should not be built without a fresh product decision.

### Core drills

**Practice** — `/practice` · `apps/web/src/modes/practice/`
Untimed and **endless**. A card appears; name its cost; repeat until you choose
to stop, via the always-available **End session** control in the top bar (the
same affordance that exits the other modes, given words). There is no round
length, no score, no record, and no personal best — the session closes on the
shared summary + insights showing **stats only**: questions answered, accuracy,
and the weakest cost bands.

The signed challenge deals the **whole shuffled catalog as a pool**, not a
sequence; `apps/web/src/lib/practice-deal.ts` draws from it weighted by the
player's own local `elixirdrop:cardStats`, so cards on a miss streak come back
hardest, then shaky recall, then unseen, and well-known cards stay rare but
possible. A player with no stats gets plain uniform random. The same card never
lands twice in a row.

**Unranked and unscored by design.** Runs are created `ranked: false`, never
write a leaderboard entry, have no leaderboard tab, and earn **zero Player XP** —
an endless mode paying per-question XP would make the 28-tier arena farmable.
The run still completes server-side for one reason: the validated transcript
feeds the server-owned learning stats (`services/api/src/learning.ts`).

- Input: pip keypad by default, or 4-button multiple choice, remembered in settings.
- Record: **none.** Practice has no record key at all (see `RECORD_KEYS`).
- Only Practice uses `apps/web/src/lib/choices.ts`; its 4-choice window is
  adjacent but randomly offset, so the option set never names the answer.

**Higher / Lower** — `/higher-lower` · `apps/web/src/modes/higher-lower/`
Two cards, costs hidden; **tap the card that costs more elixir**. Endless
streak. Pairs are generated so the two cards **never share an elixir cost**
(server `higherLowerPairs`), so there is always a strictly higher card and no
"equal" option is needed — the whole card is the tap target (no separate
controls; far easier on mobile). Each round runs a **shrinking response clock**:
5s to read the opening pair, 250ms less every round it survives, down to a 2s
floor (`higherLowerWindowMs`, shared by the client countdown and the server
scorer with a 250ms boundary tolerance). A wrong tap **or a timeout** ends the
run. Correct advances in 750ms; a miss holds 1.4s, resets the streak, and leaves
the revealed result in place until the player explicitly starts another run.
Trains the relative read that wins elixir trades.

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

**Rain** — `/rain` · `apps/web/src/modes/rain/`
Cards fall through the playfield and the lowest lit card is the live target.
Enter its elixir cost before it lands; a wrong tap gives a higher/lower hint but
does not stop the fall. The player has three lives. Rain is **endless and
uncapped**: difficulty scales with cleared count on **both** axes — cards fall
faster _and_ spawn closer together the more you clear — starting a touch gentler
than a fixed pace, then ramping with no ceiling, so a player in flow keeps
accelerating until the field outruns human reaction and the run ends (you cannot
play forever). Both curves key off the live score, so difficulty only advances
when you actually clear cards. The signed server deck supplies the cards and
**wraps** when exhausted (a deep run resolves more cards than the deck holds);
every resolved card records either its correct cost or a landed miss. Every 10
clears the running total flashes for ~0.5s in the middle of the field (gold
numeral + ring, echoing the 3-2-1 countdown) so the player feels progress without
reading the top bar; it is composited over the field and never reflows the board.
The scorer
validates each card id against the signed deck but does **not** cap the run at the
deck length — only a far-out-of-reach anti-abuse ceiling bounds transcript size.

- Input: pip keypad.
- Record: `rainBest` (cards cleared).
- Board epoch `r2` (2026-07-24). The pre-redesign board is retired: the old curve
  capped at 50 clears, so deep scores came off a materially easier game and are
  not comparable to runs on the uncapped curve. Old rows are orphaned, not
  deleted (`BOARD_EPOCH` in `services/api/src/games.ts`).

### "Elixir Rain" screensaver

Three doors in (`apps/web/src/lib/screensaver.ts`): the **nav launcher** — a
visible feature now, not only an egg — five quick taps on the ELIXIR DROP hero
logo (1.5s per tap), or two idle minutes on Home. The site dims into an ambient
WebGL scene: a fresh random cast of ~24 cards drifts down through elixir droplets
in three parallax layers, occasionally flipping into other cards, with the mascot
gliding through every so often. Any tap or key exits. It never triggers on a
gameplay route, pauses while the tab is hidden, and under reduced motion it simply
does not exist. Deliberate opens fire `easter_egg.screensaver_opened` with the
source as the value (`nav` or `tap`); idle attract is untracked. Purely cosmetic —
no scores, no records, no server involvement.

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
