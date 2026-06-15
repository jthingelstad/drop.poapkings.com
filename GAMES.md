# GAMES.md — Elixir Drop

The games catalog. **`SPEC.md`** is the product spec and **`CLAUDE.md`** the rules
and map; this file is the living record of what we ship to play and what's on the
backlog. Mechanic-level game decisions live here. Read it before adding or
reworking a game.

Every game shares one engine and the same seams: cards come from
`src/data/cards.json`, progress goes through `src/lib/storage.ts`, card selection
goes through `src/lib/sampling.ts`, elixir multiple-choice distractors through
`src/lib/choices.ts`, and card-name distractors through `src/lib/name-choices.ts`.

**Current product constraint:** do not add curated deck definitions. No
`decks.json`, archetype list, synergy model, or "real deck" dependency. That path
is a maintenance rabbit hole and makes small games expensive. New games should use
only the committed card facts already in `cards.json`: name, elixir, rarity, type,
and art.

---

## Shipped games

### Core

**Practice** — `/practice` · `src/modes/practice/`
Untimed. A card appears; name its cost. The weighted sampler surfaces your weak
cards; a round of 15 (with end-early) closes in the shared summary + insights.
- Input: pip keypad (default) or 4-button multiple choice, remembered in settings.
- Record: `bestAccuracy`.

**Identify** — `/identify` · `src/modes/identify/`
Card art appears with the name hidden; pick the correct card name from six
choices. A wrong pick adds +2.0s, eliminates that name, and leaves the card live.
The 15-card sprint is scored as golf time.
- Input: six card-name buttons.
- Record: `identifyBest` (lowest time).

**Surge** — `/surge` · `src/modes/surge/` · *flagship*
A 15-card speed sprint, scored as golf time (elapsed + penalties; lower wins). A
wrong answer adds +2.0s and the card stays until correct. Honest clock
(`performance.now()`); sprint images preload before the timer starts; Elixir stays
silent during the run and reacts on the summary. Produces one clean, shareable
number.
- Input: pip keypad.
- Record: `surgeBest`.

**Higher / Lower** — `/higher-lower` · `src/modes/higher-lower/`
Two cards; pick Higher, Equal, or Lower relative to the left card. Endless streak.
Trains the relative read that wins elixir trades.
- Record: `longestStreak`.

**Trade** — `/trade` · `src/modes/trade/`
You are always Blue King; Red is the opponent. Blue plays 1–3 sampled cards and
Red answers with 1–3 sampled cards. Guess your elixir trade from `-4` through
`+4`, where positive means Red spent more elixir than you. A wrong guess adds
+2.0s, reveals one persistent card-cost hint, and leaves the exchange live.
- Input: signed trade keypad (`-4 … Even … +4`).
- Record: `tradeBest` (lowest time).

### Stretch

**Blitz** — `/blitz` · `src/modes/blitz/`
A 60s count-up variant of Surge — "how many cleared." Reuses the Surge HUD.
- Record: `blitzBest`.

**Survival** — `/survival` · `src/modes/survival/`
Sudden death. A per-card 5s clock; one wrong answer *or* a timeout ends the run,
revealing the missed card's cost.
- Record: `survivalBest`.

**Speed Ladder** — `/ladder` · `src/modes/ladder/`
Sort 5 sampled cards from lowest elixir to highest as fast as possible. Drag cards
or use the explicit move controls; touch players can tap a card, then tap its
destination. Equal-cost cards are valid in either relative order. A wrong lock
adds +2.0s, reveals one persistent card-cost hint, and leaves the ladder live.
- Record: `ladderBest` (lowest time).

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
(Speed Ladder). The remaining useful whitespace is **ordering depth**, **small
arithmetic**, and **single-card estimation** — all without deck data.

### Recommended next build

**Insert / Endless Ladder** — *spatial ordering*
Cards arrive one at a time; insert each into a growing low-to-high row. A misplace
ends the run or adds a penalty, depending on how punishing the first prototype
feels. This builds directly on Speed Ladder, needs no new data, and has the best
shot at an addictive loop.

### Strong non-deck candidates

**Daily Ladder** — *shareable spatial puzzle*
A daily seeded set of 5–6 sampled cards. Same sorting rules as Speed Ladder, but
one puzzle per day with a share line. It must be framed as a daily card-cost puzzle,
not a "deck."

**Exact Ten** — *arithmetic / set-building*
Show a random pool of visible cards and ask the player to pick a subset totaling
exactly 10 elixir. This should be framed as "fill the bar" or "make 10," not deck
construction. Random pools are acceptable because the mechanic is arithmetic, not
authentic archetype recognition.

**Cost Sweep** — *scan and recall*
Show a compact grid and a target cost, then tap every card with that cost before
time runs out. Good mobile ergonomics, no deck data, and a different feel from
single-card recall.

**Mystery Cost** — *deduction*
Show a card with the elixir badge hidden and reveal type/rarity/name clues over
time or after wrong guesses. This can borrow from Cardle without becoming a daily
Wordle clone.

### Set aside

- **Curated deck definitions / `decks.json`** — rejected. Too much maintenance and
  too easy to get wrong for real players.
- **Deck-based Make Ten, Price Is Right, Spot the Splash, Daily Deck Ladder** —
  set aside because each depends on authentic decks or archetype coherence.
- **Standalone Focus** — fold into Practice if the need returns.
- **Deck Budget / Average 3.4** — removed with no planned rework.
