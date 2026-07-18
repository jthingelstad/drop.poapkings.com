# GAMES.md - Elixir Drop

This is the canonical games catalog: what ships, what is retired, and what is
only an idea. Mechanic-level game decisions live here. Read it before adding or
reworking a mode.

Doc map:

- **`README.md`** is the public overview and local-development entry point.
- **`SPEC.md`** is the current implementation spec and product constraints.
- **`CLAUDE.md`** is the agent working guide.

Shipped state as of June 15, 2026: **ten playable modes**. The home screen
spotlights **Surge** and lists nine more: Practice, Identify, Higher / Lower,
Trade, Speed Ladder, Endless Ladder, Cost Sweep, Blitz, and Survival. **Daily
Ladder is not shipped and should not be built without a fresh product decision.**

Every game shares one engine and the same shared paths: cards come from
`packages/game-data/cards.json`, local learning progress goes through
`apps/web/src/lib/storage.ts`, card selection goes through
`apps/web/src/lib/sampling.ts`, elixir multiple-choice distractors through
`apps/web/src/lib/choices.ts`, card-name distractors through
`apps/web/src/lib/name-choices.ts`, and card presentation through
`apps/web/src/lib/card-rendering.ts` plus
`apps/web/src/components/CardChrome.tsx`. Completed games also use a
server-issued signed challenge and a mode-specific transcript through
`apps/web/src/lib/use-game-run.ts`.

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
wins. A wrong answer adds +2.0s and the card stays until correct. The sprint's
images preload before the timer starts; Elixir stays silent during the run and
reacts on the summary. Produces one clean, shareable number.

- Input: pip keypad.
- Record: `surgeBest` (lowest time).

### Core drills

**Identify** — `/identify` · `apps/web/src/modes/identify/`
Card art appears with the name hidden; pick the correct card name from six
choices. A wrong pick adds +2.0s, eliminates that name, and leaves the card live.
The 15-card sprint is scored as golf time.

- Input: six card-name buttons.
- Record: `identifyBest` (lowest time).

**Practice** — `/practice` · `apps/web/src/modes/practice/`
Untimed. A card appears; name its cost. The weighted sampler surfaces weak cards;
a round of 15, with end-early, closes in the shared summary + insights.

- Input: pip keypad by default, or 4-button multiple choice, remembered in settings.
- Record: `bestAccuracy`.

**Higher / Lower** — `/higher-lower` · `apps/web/src/modes/higher-lower/`
Two cards; pick Higher, Equal, or Lower relative to the left card. Endless streak.
Trains the relative read that wins elixir trades.

- Record: `longestStreak`.

**Trade** — `/trade` · `apps/web/src/modes/trade/`
You are always Blue King; Red is the opponent. Blue plays 1–3 sampled cards and
Red answers with 1–3 sampled cards across an 8-exchange sprint. Guess your
elixir trade from `-4` through `+4`, where positive means Red spent more elixir
than you. A wrong guess adds +2.0s, reveals one persistent card-cost hint for
that exchange, and leaves the exchange live.

- Input: signed trade keypad (`-4 … Even … +4`).
- Record: `tradeBest` (lowest 8-exchange time).

### Stretch

**Blitz** — `/blitz` · `apps/web/src/modes/blitz/`
A 60s count-up variant of Surge: how many cards can you clear? Reuses the timed
cost-recall loop.

- Record: `blitzBest`.

**Survival** — `/survival` · `apps/web/src/modes/survival/`
Sudden death. A per-card 5s clock; one wrong answer _or_ a timeout ends the run,
revealing the missed card's cost.

- Record: `survivalBest`.

**Speed Ladder** — `/ladder` · `apps/web/src/modes/ladder/`
Sort 5 sampled cards from lowest elixir to highest as fast as possible. Drag cards
or use the explicit move controls; touch players can tap a card, then tap its
destination. Equal-cost cards are valid in either relative order. A wrong lock
adds +2.0s, reveals one persistent card-cost hint, and leaves the ladder live.

- Record: `ladderBest` (lowest time).

**Endless Ladder** — `/endless-ladder` · `apps/web/src/modes/endless-ladder/`
Starts with a small sorted row, then deals one hidden-cost card at a time. Insert
the new card into the correct low-to-high slot. A correct insert extends the row;
one wrong slot ends the climb.

- Input: insertion-slot buttons between ordered cards.
- Record: `endlessLadderBest` (most successful inserts).

**Cost Sweep** — `/cost-sweep` · `apps/web/src/modes/cost-sweep/`
Shows a compact grid and a target elixir value. Tap every card matching that cost
before the 45s clock runs out. Correct taps mark cards as found and clearing a
board deals a fresh grid; wrong taps cost 2s.

- Input: card-grid taps.
- Record: `costSweepBest` (most target cards found in 45s).

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

---

## Ideas & backlog

From the June 2026 refresh. The active lineup already covers speed
(Surge/Blitz/Survival), comparison (Higher/Lower), card-name recognition
(Identify), cost recall (Practice), trade math (Trade), and spatial ordering
(Speed Ladder/Endless Ladder), scan-and-recall (Cost Sweep), and small target
search. The remaining useful whitespace is **small arithmetic** and
**single-card estimation** — still without deck data.

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
A daily seeded set of 5–6 sampled cards using the same sorting rules as Speed
Ladder. It remains a valid idea, but it is **not the next build**. Do not
implement it unless it is re-approved.

### Set aside

- **Curated deck definitions / `decks.json`** — rejected. Too much maintenance and
  too easy to get wrong for real players.
- **Deck-based Make Ten, Price Is Right, Spot the Splash, Daily Deck Ladder** —
  set aside because each depends on authentic decks or archetype coherence.
- **Standalone Focus** — fold into Practice if the need returns.
- **Deck Budget / Average 3.4** — removed with no planned rework.
