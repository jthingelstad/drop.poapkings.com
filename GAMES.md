# GAMES.md - Elixir Drop

This is the canonical games catalog: what ships, what is retired, and what is
only an idea. Mechanic-level game decisions live here. Read it before adding or
reworking a mode.

**Doc map:** `AGENTS.md` → "Doc map" is the canonical list of every doc and what it
owns.

Shipped state as of August 20, 2026: **six playable game families** — Surge,
Practice, Higher / Lower, Trade, Survival, and Rain. Practice is one endless
card-cost drill. It is unranked, has no record, and awards **no Player XP** — it
deliberately touches no competitive surface, which is exactly what lets it run
forever.
Player XP is a per-player activity score (one point per question practiced, right
or wrong) that drives the arena and is earned by the other five modes;
leaderboards rank on speed. **Daily Ladder is not shipped and should not be
built without a fresh product decision.**

**Guest play (no account):** every mode is playable signed-out. A guest is dealt
the same server-signed challenge and scored the same way, but the run records
**nothing** — no leaderboard, no all-time, no XP, no history. After a guest run
the summary invites the player to sign in before the next game so future scores
can be recorded (Surge, Higher / Lower, Survival, and Rain via the shared
`Summary`; Trade on its own result screen). A completed guest result is never
promoted retroactively. Practice has no score to save and shows neither that
nudge nor a share action.
Local personal bests still track on-device — except Practice, which keeps no
best for anyone. Signing in unlocks recording and ranking.

**Offline play:** every mode uses the same browser game loop and shared deal
rules without creating a server run. The result is session-only: no local
personal or season best, account history, Player XP, badge progress, daily
activity, global game count, or leaderboard entry, and it is never queued for a
later reconnect. The result screen remains available and labels the run
"Offline — not saved." Existing device-local learning behavior remains intact:
Practice, Surge, and Survival can still sharpen future drills on that device
without changing canonical player progress. A run that starts offline stays
offline; a signed online run that loses connectivity keeps its normal
completion-retry path.

Every game shares one engine and the same shared paths: cards come from
`packages/game-data/cards.json`, local learning progress goes through
`apps/web/src/lib/storage.ts`, and card selection comes from the shared
challenge generator (signed by the server for official play and invoked locally
for offline play, then resolved by `apps/web/src/lib/game-challenge-content.ts`).
Card presentation goes through
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
A strict new season or all-time leader is recorded under a neutral Fair Play hold
and **ranks provisionally** while it waits — only an excluded run leaves a board.
Exact ties do not trigger that leader hold. Technical integrity signals use the
same reversible path. Repeated
confirmed automation can separately restrict future ranked starts after Jamie's
explicit approval, while Practice and account access remain available.

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
the run and reacts on the summary. Live time, summaries, personal bests, and
leaderboards all show the same three decimal places. Produces one clean,
shareable number.

- Input: pip keypad, always dealt as two wide rows (1–5 over 6–9).
- Record: `surgeBest` (lowest time).

**Season competition — the Free Pass.** Surge carries a real prize: the player
ranked first on its seasonal leaderboard at season end wins a Clash Royale
season pass. Two standing consequences:

- **The board does not certify itself.** An automatic integrity flag
  (`automaticReviewReason` / `underReview`) is a review _signal_, never a
  verdict — and it is treated as one. The flag writes a `review`/`hidden`
  decision inside the same transaction that records the score
  (`services/api/src/repository.ts`), but the run **still ranks**: the board
  reads `services/api/src/referee-status.ts`, where a pending decision ranks
  provisionally and only `excluded` removes a row. The run scores, records,
  earns XP, keeps its place, and wears the Awaiting seal while it waits. The
  standing must be referee-reviewed before the pass is awarded; that obligation
  lives in `AGENT-TEAM/protect-fair-play.md`.
- **A strict new season or all-time leader goes to the referee, and ranks while
  it waits.** The completion is recorded, retains XP and history, and takes its
  real placement provisionally under the Awaiting seal. The one read that still
  withholds a pending run is `seasonPodiumFinishers`: a provisional placement is
  reversible and a finalized podium is not. Forced 280ms correct-card
  transitions are excluded from the active response budget, so reduced motion
  does not make an honest run look mechanically fast.
- **Attempt volume is legitimate and stays that way.** Best-single-run scoring
  means more attempts yield a better best. That is accepted on purpose:
  grinding Surge _is_ drilling elixir costs, which is the whole product. Do not
  cap ranked attempts or move the board to recent-form ranking to "fix" it.

The winner is picked manually at season end. There is no automated snapshot or
award pipeline, and one should not be built without a fresh product decision.
The announced mode, eligibility, tie-break, seven-day response window, and
gift-only prize terms live on the stable POAP KINGS Free Pass rules page; the
in-game hero links there rather than duplicating the full rules.

### Core drills

**Practice** — `/practice` · `apps/web/src/modes/practice/`
Practice is the one training mode and opens directly into its focused game
shell. It cannot acquire a leaderboard or record: those competitive surfaces
are unrepresentable for the `practice` GameMode.

Untimed and **endless**. A card appears; name its cost; repeat until you choose
to stop, via the always-available icon-only close control in the top bar
(accessibly named **End session**). There is no round
length, no score, no record, and no personal best — the session closes on the
shared learning summary showing **stats only**: first-read accuracy, average
response time, recovered misses, cards still needing review, and cost bands.
Practice has no destination, so its running chrome counts cards practiced and
first reads but renders no left-to-right progress bar.

The signed challenge deals the **whole shuffled catalog as a pool**, not a
sequence; `apps/web/src/lib/practice-deal.ts` draws from it weighted by the
player's own local `elixirdrop:cardStats`, so cards on a miss streak come back
hardest, followed by inaccurate or slow recall, then unseen cards; fluent cards
stay rare but possible. Recognition with choices is useful but is tracked
separately and never counted as fluent recall. A player with no stats gets plain
uniform random. The same card never lands twice in a row.

The learning loop has three layers:

- A correct first read enlarges the cost directly over the card with a strong
  drop shadow so it stays readable without becoming a separate badge. It holds
  stable for at least 300ms and until the next art is decoded, then remains
  attached while the solved card exits. Reduced motion uses the same learning
  hold with a short fade.
- A wrong keypad read gets one anchored directional scaffold (`Higher than 4`
  or `Lower than 7`) that stays beside the card until the retry. A second miss
  reveals and holds the exact cost for 1.6 seconds; a wrong recognition choice
  uses the same teaching hold after its wrong beat rather than encouraging
  elimination guesses.
- A miss is guaranteed to return after four other reads. A repeated review miss
  returns after three; a successful retry receives a longer-gap confirmation
  after ten. Recovery cues say `Got it back!` and `Locked in!`.

First-response time is recorded invisibly after the card is paint-ready,
excluding background-tab time and capped at 60 seconds. After seven idle seconds
the player may request help: keypad recall becomes four choices, while an
already-visible choice set narrows to two. Help is voluntary and never reveals
the answer. Practice deliberately has no streak or ten-answer milestone effect;
the summary's primary action becomes **Review misses** when the session has any.

**Unranked and unscored by design.** Runs are created `ranked: false`, never
write a leaderboard entry, have no leaderboard tab, and earn **zero Player XP** —
an endless mode paying per-question XP would make the 28-tier arena farmable.
The run still completes server-side for one reason: the validated transcript
feeds the server-owned learning stats (`services/api/src/learning.ts`).

- Input: pip keypad by default (two wide rows, 1–5 over 6–9), or 4-button multiple
  choice, remembered in settings.
- Record: **none.** Practice has no record key at all (see `RECORD_KEYS`).
- Sharing: **none.** An endless drill has no comparable result worth publishing.
- Only Practice uses `apps/web/src/lib/choices.ts`; its 4-choice window is
  adjacent but randomly offset, so the option set never names the answer.

**Higher / Lower** — `/higher-lower` · `apps/web/src/modes/higher-lower/`
Two cards, costs hidden; **tap the card that costs more elixir**. Pairs are
generated so the two cards **never share an elixir cost** (server
`higherLowerPairs`), so there is always a strictly higher card and no "equal"
option is needed — the whole card is the tap target (no separate controls; far
easier on mobile). The player has **three lives**, rendered with the same
filled / open heart row Rain uses. Trains the relative read that wins elixir
trades.

**Score is total correct reads across the session**, not the longest unbroken
run — the same shape as Rain. A wrong tap **or a timeout** reveals the answer,
costs one life, and the run **continues**; the run ends when the third life
goes. Correct advances in 750ms; a miss holds 1.4s, and the final miss leaves
the revealed result in place until the player explicitly starts another run.
Every ten correct reads receives the shared centered milestone flash.

Two difficulty axes, both of which tighten:

- **The clock keeps accelerating.** It uses Survival's hyperbolic curve: 5s to
  read the opening pair, below 3s by round 10, below 2s by round 26, and always
  tightening toward an 800ms asymptote (`higherLowerWindowMs`, shared by the
  client countdown and the server scorer with a 250ms boundary tolerance). The
  round index counts **every pair presented, missed ones included** — client
  and server agree on that definition. This replaces the old 2s floor and starts
  board epoch `r3`: the same player's production best fell from 87 to 35 across
  the change, so the score populations are demonstrably not comparable.
- **The elixir gap ramps.** Gaps used to be uniformly random forever, which made
  the hardest possible pair (a 1-elixir gap) the single most common opening.
  Now the target gap is a pure function of the round index (`higherLowerGap`):
  4+ elixir for the first ~6 rounds, blending down through 3s and 2s, and a
  1-elixir call from round 18 on. The fractional part of the target is spent as
  a weighted coin flip between neighbouring gaps, so the bands blend instead of
  stepping. The cost pair is chosen before the cards, weighted by how many card
  pairings each cost pair can make — the catalog has 34 four-cost cards but
  exactly one 8 and one 9, so an unweighted draw would put Golem and Three
  Musketeers in most wide openings.

- Record: `higherLowerContinuousBest` (total correct). Renamed from r2's
  `higherLowerBest`, which itself replaced `longestStreak`; each rename orphans
  an on-device target earned under materially different rules.
- Leaderboard tiebreak: **score, then fewest lives lost, then fastest cumulative
  time** (the sort key's first mode with two ordered tiebreaks).
- Board epoch `r3` (2026-08-08). `r2` introduced three lives and the gap-ramped
  deal on 2026-07-25, retiring the one-life board. It is now retired in turn
  because its response clock flattened at 2s while r3 keeps tightening toward
  800ms. Old rows are orphaned, not deleted (`BOARD_EPOCH` in
  `services/api/src/games.ts`).

**Trade** — `/trade` · `apps/web/src/modes/trade/`
You are always Blue King; Red is the opponent. Blue plays 1–3 dealt cards and
Red answers with 1–3 dealt cards across a **10-exchange** sprint. Guess your
elixir trade from `-4` through `+4`, where positive means Red spent more elixir
than you. A wrong guess adds +2.0s, reveals one persistent card-cost hint for
that exchange, and leaves the exchange live. A solved exchange reveals every
cost and both side sums ("Blue 7 · Red 9 → +2") for a beat and then deals the
next exchange automatically — there is no Next button, because the run is timed
and advancing must never wait on another tap.

- **Board ladder (fixed, the same every run — only the cards vary):**

  | R1  | R2  | R3  | R4  | R5  | R6  | R7  | R8  | R9  | R10 |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 1v1 | 1v1 | 1v1 | 1v2 | 2v1 | 2v2 | 2v3 | 3v2 | 3v3 | 3v3 |

  `TRADE_LADDER` in `packages/contracts` is the one definition of it, and
  `TRADE_ROUNDS` (its length) is the run length both the server deal and the
  browser read, so the two cannot drift. The first third is plain 1v1 reads —
  the fundamental this mode teaches — then boards grow one card at a time and
  the full 3v3 arrives only at the finish. Lopsided rungs alternate which side
  is longer so the sign of the answer keeps flipping. The old deal rolled both
  side sizes at random and sorted by card count, which reached 3v3 by round 8
  with no run of simple boards to learn on; Trade was the least-played ranked
  mode, at a median 77.6s over 8 exchanges (~9.7s each, against Surge's ~1.3s
  per card).
- Cards are dealt by rejection: the value has to land inside the keypad's
  -4..+4, so a board is redealt until it does (bounded, and a shape that cannot
  land fails the run start rather than spinning).
- Input: the shared exchange board (`components/game/ExchangeBoard.tsx`) — a RED
  and a BLUE magnitude row (1–4) with EVEN between. A blue key submits `+n`, a
  red key `−n`; the signed −4…+4 keypad was retired.
- Scoring: golf time (elapsed + 2.0s per miss), unchanged. Trade drills a read
  that a real match asks for under time pressure, so the clock is the point.
  Live time, summaries, personal bests, and leaderboards use three decimal
  places, matching the millisecond score used for ordering.
- Record: `tradeLadderBest` (lowest 10-exchange ladder time). Renamed from
  `tradeBest`, which orphans existing on-device bests on purpose — a 10-round
  run cannot beat an 8-round time, so keeping the key would retire the player's
  personal best forever.
- Board epoch `r2` (2026-07-25). The 8-exchange board is retired: the run is
  two exchanges longer _and_ a different climb, so old times are neither
  beatable nor comparable. Old rows are orphaned, not deleted (`BOARD_EPOCH` in
  `services/api/src/games.ts`).

### Tension

**Survival** — `/survival` · `apps/web/src/modes/survival/`
Sudden death. The per-card clock starts at 5s and keeps tightening on a
hyperbolic curve — **below 3s by a 10 streak, below 2s by 26**, and ~1.1s on the
deck's last card — toward an 800ms ultimate ceiling (one shared curve,
`survivalWindowMs`, enforced server-side). One wrong answer _or_ a timeout ends
the run, revealing the missed card's cost; hiding the tab ends the run with the
streak intact. The deck is **every card once** (no repeats), so clearing it is a
**WIN** (max streak = the catalog, 120). The leaderboard ranks on **streak
count, then fastest cumulative time** (`survivalTimeMs` → the sort key's
tiebreak), so once everyone can clear the deck it becomes a speedrun.

- Record: `survivalBest` (streak). Cumulative time is the leaderboard tiebreak.
  The selected leaderboard mode already supplies the meaning, so its primary
  score column shows the bare card count rather than repeating “streak.”

**Reviewed 2026-07-25 and deliberately left alone.** Three things about Survival
look like problems and are not:

- **The back half barely tightens.** The 800ms floor is only approached at a
  streak of ~201, and the deck ends at 120, so cards 50→119 squeeze just
  1500ms → 1126ms. Steepening it was considered and rejected: the wall in the
  real data is early (24% of runs score zero, 37% under 3), while runs that get
  past ~10 tend to go deep. Making the back half harder would punish the players
  who are already succeeding and would not touch the part that actually stops
  people.
- **It is the only tension mode without lives.** Higher/Lower and Rain both give
  three. Survival's single life is the point — it is what makes a clear mean
  something, and adding lives would make it Rain with different art. Do not
  "harmonize" the three modes.
- **A clear collapses the board into a time race.** That is the intended second
  act, not a flaw: first prove you can clear the deck, then race it. The
  cumulative-time tiebreak already implements it, so no work is pending.

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
every resolved card records its correct cost or a landed miss, the elapsed time
at resolution, and the wrong taps it cost. Every 10
clears the running total flashes for ~0.5s in the middle of the field (a gold
numeral echoing the 3-2-1 countdown) so the player feels progress without
reading the top bar; it is composited over the field and never reflows the board.
The scorer
validates each card id against the signed deck but does **not** cap the run at the
deck length — only a far-out-of-reach anti-abuse ceiling bounds transcript size.

- Input: pip keypad, always dealt as two wide rows (1–5 over 6–9).
- Record: `rainBest` (cards cleared).
- Leaderboard tiebreak: **fewest wrong guesses, then lowest average clear
  latency** (`MODE_TIEBREAKS`). Wrong guesses count every wrong tap in the run,
  landed cards included. Latency is **derived server-side**, never reported: it
  is each clear's `atMs` minus the earliest moment that tile could have spawned,
  so it measures the player's answer rather than the pace the game happened to
  run at, and there is no separate number a client could inflate.
- Board epoch `r3` (2026-07-25). `r2` is retired because it carries no tiebreak
  segment and cannot be backfilled — those transcripts hold no timing at all —
  and two key shapes in one partition would let a new row outrank an equal
  old one purely on segment ordering. (`r2` itself retired the pre-redesign
  board on 2026-07-24, whose curve capped at 50 clears.) Old rows are orphaned,
  not deleted (`BOARD_EPOCH` in `services/api/src/games.ts`).

**The minimum-time floor.** Rain has no round length and no clock, so nothing
about its shape bounded a run: a transcript of deck-valid card ids scored up to
the 10,000 anti-abuse ceiling, instantly and clean. It is bounded now by the one
thing that is deterministic — the spawn curve. Difficulty is a function of the
cleared count and the count only rises by one per clear, so the n-th spawn gap is
never shorter than `rainSpawnIntervalMs(n)`, and **a score of N needs at least the
first N gaps of elapsed time**: 10.9s for 10 clears, 44.4s for 50, 75.7s for 100,
124.8s for 200 (`rainSpawnFloorMs`, with the curve, in `packages/contracts` —
shared with the browser so the floor always describes the game actually being
played). The fall speed is deliberately **not** part of it; it carries a random
per-tile component.

The floor is checked twice: against the transcript's own `atMs` stamps per card,
and against the server's wall clock, which no client can write. A run under it,
by more than a 2s tolerance, is **sent to referee review — never rejected**. It
still scores, still records, still earns XP, and it still ranks: the hold is a
queue state, so the run takes its real placement provisionally under the Awaiting
seal until a referee decides. The floor is a difficulty model, and a model is
exactly the kind of thing that false-positives on an exceptional player — which
is precisely why it no longer costs that player their rank while they wait.

### "Elixir Rain" screensaver

Three doors in (`apps/web/src/lib/screensaver.ts`): the **nav launcher** — a
visible feature now, not only an egg — five quick taps on the ELIXIR DROP hero
logo (1.5s per tap), or two idle minutes on Home. The site dims into an ambient
WebGL scene: a fresh random cast of ~24 cards drifts down through elixir droplets
in three parallax layers, occasionally flipping into other cards. Any tap or key
exits. It never triggers on a
gameplay route, pauses while the tab is hidden, and under reduced motion it simply
does not exist. Deliberate opens fire `easter_egg.screensaver_opened` with the
source as the value (`nav` or `tap`); idle attract is untracked. Purely cosmetic —
no scores, no records, no server involvement.

### Shared active-play chrome

Timed active states use the `game-run` layout: compact header, no footer, and no
star counter while the player is actively timed. Keep controls visible on mobile
and guard against horizontal overflow in e2e tests when adding or changing modes.

### The summary signature chart — one grammar, five modes

Every ranked summary draws the same chart from
`apps/web/src/components/summary/SignaturePanel.tsx`: **bars in seconds, a
per-bar reference tick in seconds, and a red bar where that bar cost you.** The
first version gave each mode whatever series seemed most interesting about it
and only Surge was readable, because Surge was the only chart whose bars and
reference shared a unit — Rain plotted clears against fall *speed*, Trade
printed retry *counts* under time bars, Higher / Lower hung right-or-wrong dots
below them. Each asked the player to hold two scales at once.

Four parts are mandatory and live in the component, so no mode can ship without
them: a **named unit** (top left), a **named reference with its tick drawn
beside the words** (top right), a **scale** (max and zero on the axis), and
**one sentence of finding** — what the chart proves, never what it shows. A
fifth rule is `badLabel`: red never means one thing inferred from colour, so
each mode names its own cost.

| Mode | Bars | Reference tick | Red bar means |
| --- | --- | --- | --- |
| Surge | Seconds per card | The same card in your best run | slower than your best there |
| Rain | Seconds to answer | How long that card had left to fall | a life lost |
| Survival | Seconds to answer | Your window at that streak | the card that ended it |
| Trade | Seconds per exchange | Your average round this run | it took a retry |
| Higher / Lower | Seconds per read | Your average read this run | a wrong read |

Rain and Survival deliberately share a shape because they share a truth: a
shrinking allowance against a steady hand. They differ only in what is marked —
Rain's three lives, Survival's one fatal card. Both record the fall time and the
window **per answer** (display-only refs, never in the signed transcript);
without that the reference tick cannot be drawn.

**Long runs bucket in the component, never in a mode.** Up to 30 answers get one
bar each; beyond that the series folds into 30 bars, each a stretch's mean
against that stretch's mean reference, with the x axis naming the range it
covers. A fatal final answer always keeps its own bar.

**Practice is exempt** and uses `summary/DrillPanel.tsx` instead. Its review bars
answer "what stuck". Practice is not racing anything, so seconds are the wrong
unit — do not force it into this grammar.

### The summary never keys a referee

A summary shows what happened, not what is pending. There is no "Awaiting a
referee" line and no awaiting seal on a summary head: at the moment a run ends
*every* recorded run is awaiting, so a mark every run carries tells a player
nothing. A cleared seal is never drawn there either — a referee reads input
evidence and takes minutes. The verdict is met later, on the boards, in the run
log, and in Updates. The one seal a summary still draws is **not recorded**,
because that is what happened.

---

## Retired games

These are intentionally out of the active app surface. Do not reintroduce them as
separate tiles without a fresh product decision.

**Ledger** — removed.
Drop is itself practice; a second Practice drill split the product without
adding a distinct core experience. Its UI, route subtype, scoring, learning
aggregate, and browser storage support were removed together.

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


---

## Badges

29 badges over 197 rungs, backed by `BADGES` in `packages/contracts` and the pure
engine in `services/api/src/badges.ts`. 22 visible badges on long ladders plus 7
hidden single-rung badges.

**Why ladders, not tiers.** Three tiers means a player who clears tier III is done
with that badge forever — it stops motivating exactly the player who cared most.
A long ladder always has a next rung visible, so rung one can land in a first
session *and* the top rung remains a genuine long-haul target.

**Rungs are calibrated against real data, not feel.** Measured on 2026-08-02:
Surge n=16 (best 12.9s, median 25.4s, worst 67.3s), Higher/Lower n=5, Survival
n=4, and Rain n=4. Sharp Trade was rechecked on 2026-08-06 against four accepted
10-exchange runs across two visible players (best 67.126s, median 75.591s,
slowest 266.570s): its 300s opener gives that learning run a first milestone,
240s is the next step, and Tyler's best clears 72s with 65s next. The later
38.847s all-time record clears the 40s prismatic target approved on 2026-08-20.
The design draft's Clockbreaker ladder put five consecutive
rungs (13–17s) above a 4.7s gap in the real field, so four of them separated
nobody, while its entry rung excluded 31% of players outright. Ladders with no
live data behind them are marked "scaled" in the table and should be re-checked
once badge counters have a month of history. Coin Flip Killer was recalibrated
on 2026-08-08 when Higher/Lower moved to r3. Tyler's 2026-08-16 play testing
then produced the approved follow-up: Trade Reader runs
`3·5·10·15·25·35·50·75·100·125·150`; Surge Runner runs
`5·10·25·50·75·100·125·150·200·250·300·450`; Downpour keeps its first six
steps and ends `135·150`; and Coin Flip Killer keeps `5–50` before new `60·70`
steps. The live Rain best was 145 and the live Higher/Lower best was 68, leaving
150 and 70 respectively as the next prismatic targets. The 2026-08-20 product
review then set the current top rungs: Bridge Read `5K`, Stormchaser `10K`, Reps
`10K`, Spellcaster `3K`, and Sharp Trade `40s`.

**Daily Drop counts days, not streaks.** Each distinct recorded local calendar
day advances it once, whether the player uses a ranked mode or Practice. Days do
not need to be consecutive; extra runs on the same day still belong to Marathon.
Guest and offline play remain unrecorded and therefore move neither badge. The
existing `3·7·14·30·60·100·180·365` ladder is unchanged and rebuilds from
history; legacy rows use their UTC completion date because they retain no local
timezone.

**Hidden badges.** Shown as a flat black silhouette of the real glyph until
earned. The badge name stays visible, but its art and earning condition are the
mystery; once earned, the detail sheet explains exactly what triggered it.
**Never show a hidden count**: "3 of 7 found" turns discovery into a checklist
and makes players feel behind. Six of the seven are earnable in a single run;
only Collector is a long game.

**What backfills and what does not.** Run history stores mode, score, seasonId,
completedAt, and the board epoch that dealt new runs — not transcripts. So the
volume and skill ladders, Drop Regular, Arena Climber, All Six, Daily Drop,
Marathon, Night Shift and the four card-knowledge badges rebuild from history
plus the `CARDSTATS` item; Reps, Clean Sweep and the five transcript-derived
hidden badges are forward-only. Mode-mastery ladders keep legitimate historical
activity across formats, while the four format-comparable skill badges — Sharp
Trade, Coin Flip Killer, Unbroken, and Downpour — accept only their current
board epoch; legacy rows without an epoch use the verified production cutover.
Unbroken ends at 120 because Survival deals the catalog once and a full clear
ends the run. Podium is resolved from the referee-visible top three in every
ranked mode when the first newer Clan Wars clock arrives. Each season+mode
finish has a durable marker, so queue redelivery or an explicit historical
finalization cannot double-count it.
