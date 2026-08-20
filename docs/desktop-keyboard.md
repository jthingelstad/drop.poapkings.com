# Desktop keyboard support

Status: **assessment + proposal, nothing implemented.** Written 2026-08-19.

Two questions, and they turn out to be separable:

1. **Is Drop playable from a keyboard on desktop?** Mostly yes, and more of it is
   built than anyone can tell — but only two modes are reachable, and not one
   binding is discoverable.
2. **Should keyboard play unlock the five ranked modes on desktop?** That is not
   a keyboard-support question. It is a board-comparability question with a prize
   attached, and it is answered separately at the bottom.

---

## What exists today

Every binding goes through `apps/web/src/lib/use-game-keys.ts`, which is already
careful in the right ways: modifier chords belong to the browser, `event.repeat`
is dropped so a held key cannot machine-gun answers, and anything typed into a
field belongs to that field.

| Surface | Keys | Reachable on a mouse-only desktop? |
| --- | --- | --- |
| Pip keypad — Surge, Survival, Rain, Practice (`PipKeypad.tsx`) | `1`–`9` | **Practice only** |
| Higher / Lower (`HigherLower.tsx`) | `↑`/`↓`, with `←`/`→` aliases | No |
| Exchange pad — Trade, Ledger (`Trade.tsx`, `Ledger.tsx`) | `1`–`4` Blue, `6`–`9` Red, `0`/`5` Even | **Ledger only** |
| Detail dialogs (`DetailModal.tsx`) | `Escape`, `Tab` trap | Yes |
| Falling Cards screensaver (`Screensaver.tsx`) | any key exits | Yes |

**The bindings for the ranked modes are already written.** They are not reachable
because `isRankedTouchGate()` stops a mouse-only device before the mode mounts,
not because the keys are missing. Whoever built each mode wired its keyboard path
and then the input gate made it unreachable — Surge, Survival and Rain inherit the
keypad's `1`–`9`, and Trade's map is deliberately mirrored into Ledger so the two
share one learned control.

## What is missing

**1. Nothing is discoverable.** There is no on-screen hint, no help sheet, no
mention on the Game Setup page, and no word in any settings surface. Grep the app
for player-visible copy about a key and there is none. A desktop player finds the
number keys by guessing, and never finds `↑`/`↓` at all because Higher / Lower is
gated off anyway.

**2. Practice's four-choice input has no keyboard path.** `MultipleChoice.tsx`
renders four buttons and binds nothing. This is the one gap that hurts today,
because Practice is one of only two modes a desktop player can reach, and the
keypad/4-choice toggle is a shipped setting — choosing the scaffold silently costs
a desktop player their keyboard.

**3. Focus never moves when the screen does.** A run auto-starts, plays, and lands
on the summary without focus following it. A keyboard player finishing a run has
to `Tab` in from the top of the document to reach *Play again*. The buttons are
reachable; the journey is not.

**4. No way out of a run from the keyboard.** `GameFrame`'s quit control is a
button with an accessible name, so `Tab` reaches it, but there is no key for it
and no convention (`Escape`) wired.

**5. There is no global focus ring.** Ten `:focus`/`:focus-visible` rules exist
across `styles.css`, all bespoke; everything else relies on the UA default. That
is survivable but thin for a surface we are proposing to make keyboard-first — and
the keypad keys themselves have no focus treatment at all.

---

## Recommended bindings

### Tier 1 — worth doing regardless of the ranked decision

These fix what is broken for the two modes desktop can already play, and they
prepare the ground if ranked ever opens.

| Binding | Surface | Why |
| --- | --- | --- |
| `1`–`9` | `MultipleChoice` | Bind the **cost**, not the position. The four options are adjacent costs (`lib/choices.ts`), so binding the digit means the same key means the same elixir cost in both input styles, and switching scaffold never relearns a control. Digits not on screen do nothing. |
| `Escape` | Preamble and summary | Leaves for Home. Cheap, expected, no run at risk. |
| `Escape` | **During** a run | **Focus the quit control; do not fire it.** Leaving a run abandons it, and an unconfirmed single keystroke that destroys a competitive run in progress is a footgun. One deliberate second press then confirms. |
| `Enter` | Summary | Fires the gold primary (*Play again*). Native once focus lands there — see below. |
| Move focus to the summary heading on completion | Every mode | The actual fix behind `Enter`. Also an accessibility win, not only a desktop one. |
| `?` (`Shift+/`) | Anywhere outside a field | Opens a keyboard help sheet listing the bindings for the current surface. This is the answer to "nothing is discoverable" — one convention, one place, no per-mode captions cluttering a play area we deliberately stripped of instructions. |

Plus: a `:focus-visible` ring on the pip keypad and exchange pad keys, using the
gold `outline: 3px solid var(--gold); outline-offset: 2px` already established on
`.favorite-card`.

### Tier 2 — desktop reading

Low value, listed for completeness. The nav is four items and `Tab` handles it;
`g`-prefixed sequences would be inventing a convention for a phone-shaped app.
**Recommend not doing this.**

### Tier 3 — the ranked unlock

Covered below. It is not a bindings problem.

---

## The ranked unlock

The instinct is right that keyboard support is what makes desktop competitive
play *possible*. The problem is what it does to a board that already exists.

### Blocker 1 — one board, two input classes, ranked purely on speed

Leaderboards order on milliseconds. A keyboard player's hand covers `1`–`9`
without travelling; a thumb player repositions across a 390px pad for every
answer. That is a real, systematic advantage, not a skill difference, and Drop
has one board per mode.

Surge is the sharp case. It is the mode with the prize (the Free Pass goes to the
season's #1), and it is the one mode with **no board epoch** — `BOARD_EPOCH` in
`services/api/src/games.ts` has entries for Survival, Rain, Higher/Lower and
Trade, and none for Surge. Its board has never been reset, which is why
Clockbreaker's live 12.861s record still stands there.

So mixing input classes into that board either:

- **devalues every existing Surge time**, including the record the badge ladder
  was calibrated against on 2026-08-02, or
- **requires a Surge board epoch**, which resets the standings the Free Pass is
  currently being competed for.

Neither is a thing to do quietly mid-season.

### Blocker 2 — the automatic review thresholds were calibrated on thumbs

`services/api/src/timing-evidence.ts` holds a Surge run for referee review when:

- `activeTotalMs < 4500` across the run (~300ms per card of display-to-input), or
- `under100MsCount >= 3`, or
- `longestUnder200MsStreak >= 4`.

Active time excludes the forced 280ms card transition, so the current 12.861s
record works out to roughly 600ms per card of real reading time — about twice the
floor. **A keyboard player plausibly halves that.** If keyboard input lands
anywhere near 300ms per card, honest desktop runs start tripping
`surge_active_time_below_review_floor` as a matter of course, and the sustained
sub-200ms streak becomes reachable on a lucky stretch of familiar cards.

These thresholds have never seen keyboard data. Their false-positive rate under
keyboard input is not "probably fine" — it is **unmeasured**. Review is an agent
role run roughly daily with no queue and no watermark, so a flood of honest holds
is a slow, quiet failure that lands on real players.

### Blocker 3 — it undoes a feature that shipped yesterday

`supportsTouchPlay()`, the gate copy ("fifteen cards in under twenty seconds on a
keypad built for two thumbs, so the board compares like with like") and the QR
bridge onto the phone all exist to make the touch-only rule legible and crossable.
Unlocking keyboard ranked play retires all of it. That is a fine trade if made
deliberately; it is a bad one made as a side effect of adding shortcuts.

### Options

**A. Don't unlock. Invest Tier 1 and make Practice genuinely excellent on
desktop.** Desktop's job stays train / watch / read, which is what the desktop
pass just built for. Zero risk to the board or the prize. *Recommended for now.*

**B. Unlock behind a separate board.** Add an input-class dimension to
`leaderboardPartition` (it already takes a board epoch, so the shape exists) and
rank keyboard runs against each other. Honest, comparable, and the Free Pass
board is untouched. Costs: a schema and scope change, a board picker that now has
two axes, badge derivations that must choose an axis, and a second cohort thin
enough that a board of three people may not be worth having yet.

**C. Unlock onto the existing boards with a Surge epoch reset.** Cleanest data
model, highest human cost: it throws away the standings a prize is being competed
for. If this is ever the answer, do it at a season boundary, announced, never
mid-season.

**In every case, Blocker 2 must be measured before any keyboard run can rank.**
The cheapest way is to collect the data without ranking anything: let desktop
keyboard players run Surge *unranked* for a period, keep the timing evidence
(which is already written for every ranked run and would need extending to this
path), and look at the real distribution of `activeTotalMs` and the sub-200ms
streaks before deciding where the floors belong for that input class.

---

## Recommendation

Do **Tier 1** now. It is small, it is entirely upside, it fixes a real gap on the
one drill desktop players actually use, and `?` finally makes the bindings that
already exist findable.

Do **not** unlock ranked play as part of it. If competitive desktop play is
wanted, it is worth doing properly as option **B**, starting with an unranked
measurement period — and that is its own project with a product decision at the
front of it, not a consequence of adding keyboard shortcuts.
