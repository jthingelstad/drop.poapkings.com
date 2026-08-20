# Referee visibility — bringing Fair Play into the game

Status: **superseded — kept as the reasoning behind what shipped.** Reviewed
2026-08-19.

Scope was approved 2026-07-25 and narrowed the same day. What actually shipped
since is both more and different, so read the summary below rather than the
proposal underneath it:

- **A held run now RANKS.** The central premise here — that a flagged run is held
  off the board until a referee clears it — is no longer how Drop works. A
  leading or technically unusual run ranks **provisionally** while it waits, and
  only an `excluded` run leaves a board. The single exception is
  `seasonPodiumFinishers`: a provisional placement is reversible, a finalized
  podium is not. Every "hide-first" statement below, including the Reality column
  in the corrections table, describes retired behaviour.
- **Section B shipped in a better form.** Not the proposed `reviewed?: boolean`
  and a `scan-eye` glyph, but a three-state seal — **Awaiting / Cleared /
  Excluded** — drawn as a struck-wax mark in `components/ReviewStatus.tsx` (CSS
  only; no emoji, no art file). `services/api/src/referee-status.ts` is the one
  classifier both the public board and the owner's history read, so the two
  surfaces cannot disagree about the same run. The design's own principle 4 held:
  **an unreviewed run wears no seal at all**, so a missing mark never reads as
  doubt.
- **Section A moved off the summary.** The own-run hold notice shipped and was
  then deliberately removed from the summary head: at the moment a run ends
  *every* recorded run is awaiting, so a mark every run carries told a player
  nothing. The hold is named in the recording toast (which also carries the run
  reference) and met later on the boards, in the run log, and in Updates.
- **Section C partly shipped.** The Fair Play page names the three states and
  explains the salted one-way fingerprints; the FAQ points at it.

What is still genuinely open is the paragraph under "Constraints worth designing
around" about sparsity, and whether any of this deserves more surface area on a
board that strangers read. The proposal is left intact below because its
reasoning — especially principles 1–4 — is what the shipped seal was built
against.

The Fair Play Referee is one of Drop's best features and no player has ever seen
it. This proposal makes it visible without turning it into an accusation
machine.

Read `SPEC.md` §11 and `AGENT-TEAM/protect-fair-play.md` first — they own the
evidence model and the referee's authority. This doc only covers what a *player*
sees.

---

## The problem, in order of severity

**1. A held run lies to its own player.** `/runs/complete` already returns
`underReview: true` (`services/api/src/routes/runs-complete.ts:350`) and the
field is declared in `packages/contracts/src/index.ts:335`. `apps/web` never
reads it — grep returns nothing. So a player whose ranked run is auto-quarantined
is shown "saved" and then silently never appears on the board. They cannot tell
whether they were flagged, whether the board is broken, or whether they
misread the rules. This is the only part of the referee's invisibility that is
actually unfair, and the bit is already on the wire.

**2. The Free Pass promise is invisible.** `GAMES.md` requires the standing to be
referee-reviewed before the pass is awarded. Today you are asked to take that on
trust. Nothing on the board shows it happened.

**3. Nobody knows the boards are policed at all.** The only player-facing
integrity copy in the whole app is one paragraph in `Privacy.tsx:61`, framed as a
privacy disclosure rather than a fairness promise.

---

## Principles

These are the guardrails. A design that breaks one of them is wrong even if it
looks good.

1. **Only ever mark the positive.** Show that a run was reviewed and stands.
   Never show `watch`, never show `hidden`, never show a `reason`.
   `AGENT-TEAM/protect-fair-play.md` forbids public accusation and forbids the
   referee contacting a player; `reason` is private by construction.
2. **Expose a boolean, never a disposition.** The API sends `reviewed: true`.
   It never sends `clear`, `watch`, `review`, or `insufficient_evidence`.
3. **`clear` and `watch` both map to `reviewed: true`.** This is the
   non-obvious one. If only `clear` earned the badge, a watched player would be
   the single row *missing* a mark their neighbours have — accusation by
   omission, legible to everyone and impossible to appeal. Both dispositions
   truthfully mean "a referee examined this and it is on the board", so both
   get the same mark and the hole disappears.
4. **Absence must stay meaningless.** Most runs are never reviewed at all and
   never will be (see "Sparsity" below), so a missing badge says nothing. This
   only holds while badges are rare. **If coverage ever approaches universal,
   omission becomes an accusation again and this design must be revisited.**
5. **A player may always know about their own run.** Telling you that *your*
   score is held is not an accusation and not "contacting a player" — it is the
   product being honest with you about your own result.

---

## What changes

### A. Your own held run tells you so

`underReview: true` gets parsed in `apps/web/src/lib/api-contracts.ts`
(`recordedRunSchema`, ~:192) and surfaced on the run's own surfaces —
`components/Summary.tsx` and/or `components/RunRecordingNotice.tsx`.

*Shipped, then narrowed:* the notice lives in `RunRecordingNotice` only. The
summary deliberately keys no referee state, because a mark that every fresh run
carries is not information.

Draft copy:

> **Held for review** — your score is recorded. It'll show on the board once a
> referee clears it.

No reason, no signal name, no threshold. "Recorded" is the load-bearing word: the
run counted, earned its XP, and is not lost.

### B. A reviewed badge on the board

A glyph in the leaderboard row meta, beside the XP chip
(`screens/Leaderboards.tsx:53-61`), where there is already an icon precedent.

- Glyph: `scan-eye` — already imported and registered in `Icon.tsx` (:26, :72).
  It reads as "looked at" rather than "policed". `shield-check` is the
  alternative. What shipped for the board is the struck-wax seal, not a lucide
  glyph.
- Accessible name: `Icon` hard-codes `aria-hidden`, so the badge needs its own
  `sr-only` text, and the row `aria-label` at `Leaderboards.tsx:43` must be
  extended — a badge nobody can hear is not a feature.
- ~~Inherited free by the desktop right rail, which consumes the same
  `LeaderboardEntry`~~ — the rail's standings block was deleted in the desktop
  pass (it repeated a board one click away), so there is no second consumer to
  keep honest.

### C. The story, told once

- **FAQ** (`apps/web/scripts/static-pages.ts`, after the leaderboards question).
  Draft, in house voice:

  > **How do you keep the boards honest?**
  > Every ranked run is scored on the server from a signed challenge, so a score
  > has to arrive with a transcript that plays back — you can't just post a
  > number. Runs that don't add up are held off the board until a referee looks
  > at them, and the referee can put them right back. Scores that have been
  > checked carry a badge.

  A multi-paragraph or linked answer needs corresponding standalone HTML in the
  static-page generator.

- **Privacy → "Fair Play"** (`apps/web/scripts/static-pages.ts`): extend rather than
  duplicate. Worth saying plainly that Drop converts IP and user-agent into
  salted one-way fingerprints at recording time and discards the originals.
  Most games doing integrity work simply keep them; this is a trust win.

---

## Data model and API

The decision overlay stays exactly as it is. Nothing here changes canonical
runs, scores, or the referee's authority — golden rule 7 still holds.

`services/api/src/leaderboards.ts` already resolves `REFEREE#{runId}/CURRENT`
for every row (:188) and currently discards everything except `visibility`. The
change is to keep one derived bit:

```
decision.disposition ∈ {clear, watch}  →  entry.reviewed = true
everything else / no decision          →  field omitted
```

Then widen `leaderboardEntrySchema` (`apps/web/src/lib/api-contracts.ts:226`)
and the matching contract with an optional `reviewed?: boolean`.

**`runId` is not currently on a leaderboard entry** and must not be added — it is
not needed for a boolean and it would hand the public a key into the evidence
partition.

---

## Constraints worth designing around

**Sparsity is permanent.** Evidence carries a 180-day TTL; decisions do not. The
first real review pass found 7 of 19 leading runs had no retained evidence and
came back `insufficient_evidence`. Old all-time records can never earn the badge.
This is fine — it is what makes principle 4 hold — but the copy must never imply
that an unbadged score is doubtful.

**Review is not scheduled.** There is no queue, no watermark, no cron. Review is
an agent role run roughly daily, with the cursor carried in handoff notes. This
is precisely why there is no "pending review" state in this design: pending would
be permanently true for nearly every score and would read as neglect.

**The referee role doc routes this as a `proposal`.** Player-facing referee state
is Jamie-approved-before-implementation by that doc's own rules. Scope was
approved 2026-07-25; the copy should get a second look before it ships.

---

## Documentation corrections — DONE 2026-07-25

Two docs described behaviour the code does not have. Both are now corrected; the
table below is kept as the record of what was wrong.

| File | Says | Reality |
|---|---|---|
| `GAMES.md:80-83` | "a flagged run stays on the board until a referee decides otherwise" | (True as of 2026-07-25: the completion transaction wrote `review`/`hidden` and the board filtered it out immediately. **Reversed since** — a held run ranks provisionally and only an excluded run leaves the board, which makes the original GAMES.md sentence right again.) |
| Retired referee role contract (Git history, 2026-07-25) | "an automatic integrity flag never removes a run from the board by itself" | same — and the retired file contradicted itself later |

`SPEC.md:386` and `services/api/README.md:155-157` already describe the
hide-first behaviour correctly.

Then, once the feature lands: `CLAUDE.md` golden rule 7 and its `AGENTS.md:39`
mirror both imply the overlay is invisible to players, and `SPEC.md` §11's
"Referee surface" section needs a player-facing note.

---

## Sequencing

1. Correct the two stale docs. (Independent, ships alone.)
2. Parse and surface `underReview` on your own run. (Closes the unfairness; no
   schema change.)
3. Derive `reviewed` server-side, widen the contract, render the badge.
4. FAQ entry and Privacy extension.

Steps 1 and 2 are worth shipping without waiting for 3.
