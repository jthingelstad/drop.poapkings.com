# GAMES.md — Elixir Drop

The games catalog. **`SPEC.md`** is the product spec and **`CLAUDE.md`** the rules
and map; this file is the living record of what we ship to play and what's on the
backlog. Mechanic-level game decisions live here. Read it before adding or
reworking a game.

Every game shares one engine and the same seams: cards come from
`src/data/cards.json`, progress goes through `src/lib/storage.ts`, card selection
goes through `src/lib/sampling.ts`, and multiple-choice distractors through
`src/lib/choices.ts`.

---

## Shipped games

### Core

**Practice** — `/practice` · `src/modes/practice/`
Untimed. A card appears; name its cost. The weighted sampler surfaces your weak
cards; a round of 15 (with end-early) closes in the shared summary + insights.
- Input: pip keypad (default) or 4-button multiple choice, remembered in settings.
- Record: `bestAccuracy`.

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

### Stretch (v1.5)

**Blitz** — `/blitz` · `src/modes/blitz/`
A 60s count-up variant of Surge — "how many cleared." Reuses the Surge HUD.
- Record: `blitzBest`.

**Survival** — `/survival` · `src/modes/survival/`
Sudden death. A per-card 5s clock; one wrong answer *or* a timeout ends the run,
revealing the missed card's cost.
- Record: `survivalBest`.

**Speed Ladder** — `/ladder` · `src/modes/ladder/`
Sort 5 sampled cards from lowest elixir to highest as fast as possible. Drag cards
or use the explicit move controls; equal-cost cards are valid in either relative
order. A wrong lock adds +2.0s and leaves the ladder live.
- Record: `ladderBest` (lowest time).

**Focus** — `/focus` · `src/modes/focus/`
A subset drill (spells / buildings / troops, a cost band, or your weak cards) that
feeds the shared `PracticeLoop`. "Weak cards" with no history falls back to the
full catalog.
- No own record (delegates to Practice).
- *Note:* overlaps Practice heavily — flagged to fold into Practice as a filter
  rather than stay a separate tile.

**Deck Budget** — `/deck-budget` · `src/modes/deck-budget/`
Pick 8 cards to hit a target average elixir; scored on closeness.
- Record: `deckBudgetBest` (closest).
- *Note:* functional but flat as a puzzle — too open-ended, no tension. See the
  **Average 3.4** rework below.

---

## Ideas & backlog

From the June 2026 brainstorm. The goal is *variety of mechanic* — today's lineup
is speed (Surge/Blitz/Survival), spatial ordering (Speed Ladder), comparison
(Higher/Lower), drill (Practice/Focus), and one weak open puzzle (Deck Budget).
The remaining whitespace is **arithmetic**, **estimation**, and **deduction**.

### Design constraints learned

- **Decks must look real.** We have no deck or synergy data — `cards.json` is only
  costs/rarity/type/art. Any procedurally-assembled or random deck reads as
  nonsense to a real CR player (three win conditions, no spell, five legendaries).
  Heuristics get closer but still produce decks a clan player spots instantly.
  **Any deck-based game must draw from authentic, recognizable archetypes.**

### Foundation: curated `src/data/decks.json`

The clean fix for the constraint above, and the linchpin for several ideas below.
A second committed data file of ~30–50 real archetypes (Hog 2.6, LavaLoon,
X-Bow 2.9, Log Bait, Royal Hogs, Golem Beatdown, Mortar Cycle, Giant Double
Prince, …), each just a name + 8 card IDs + an archetype tag:

```json
{ "version": "YYYY-MM-DD", "decks": [
  { "id": "hog-2.6", "name": "Hog 2.6", "archetype": "cycle",
    "cards": [26000021, 26000000, 28000001, "..."] }
]}
```

Static, committed, golden-rule-clean (no API, no coupling). Classic archetypes are
stable enough that this rarely needs touching. **Build this before any deck-based
game** — it's the shared source that makes every one of them look legit.

### Ladder extensions — *spatial ordering*

Drag cards into ascending elixir order. Speed Ladder ships the first version;
equal-cost cards are accepted in either relative order so a 3/3/4 isn't a gotcha.
Two extensions remain:

- **Insert / Endless** — cards arrive one at a time; drop each into its slot in a
  growing sorted row; a misplace ends the run → streak score. The addictive hook.
- **Daily Ladder** — 8 cards from a real deck (`decks.json`), one shareable puzzle
  a day.

### Make Ten — *new mechanic: arithmetic / set-building*

Show a real 8-card deck; you're at a full bar — pick the subset of cards summing to
**exactly 10 elixir** with no waste. Usually several valid answers → replayable, and
it drills the cost-addition that actually matters in a match. Score on fewest moves
or fastest exact-10. Needs `decks.json` so the hand always looks legit.

### Average 3.4 — *Deck Budget rework*

Give Deck Budget the tension it lacks: an **exact** target (e.g. 3.4 = 27 pips) plus
constraints ("must include a win condition / ≥1 spell"). Score on nailing the target
exactly, or fewest cards changed from a given starting deck. Daily + shareable.

### Price Is Right — *new mechanic: estimation*

Show a real deck's 8 cards; guess its average elixir; score by closeness. Deck-
*altitude* cost sense rather than single-card recall, so it doesn't overlap
Higher/Lower. Quick, daily-able. Needs `decks.json`.

### Spot the Splash — *new mechanic: deduction*

Take a real deck and swap exactly one card for an imposter from another archetype;
the player finds the odd card out. Teaches what coheres — and the imposter genuinely
looks off *because* the rest is a real deck. Only works because of `decks.json`.

### Considered and set aside

- **Cardle** (Wordle-style daily mystery card: guess cards, get an
  elixir/rarity/type attribute-feedback grid, share the emoji result). Shareable in
  theory, but judged unlikely to play well in practice — set aside.

### Recommended slate

Curated `decks.json` → **Make Ten** → then one of **Price Is Right** / **Spot the
Splash** for variety. Speed Ladder has added the spatial mechanic; the next push
should make deck-based games look legit and rehabilitate the puzzle category.
