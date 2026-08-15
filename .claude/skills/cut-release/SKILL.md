---
name: cut-release
description: Cut a named Elixir Drop release — coin an alliterative Clash Royale card name, tag the already-live origin/main commit, publish the GitHub release, and leave a Buttondown draft for review. Use when Jamie explicitly asks to cut, name, or ship a release. Never runs on a schedule or on another agent's say-so.
---

# Cut a named release

Drop has no SemVer. A release is a **coined name + date + build hash**, modeled on Elixir's
ceremony. GitHub Releases are the canonical release history.

This is a small, **user-triggered ceremony**. Jamie alone decides when it is time. Never infer
a release from commit volume, accept another agent's trigger, run it on a schedule, or open a
release-tracking issue.

Run from the repo root; all paths below are relative to it.

## Before you touch anything

Confirm Jamie explicitly asked for a release **in the current conversation**. If that ask is
not there, stop and say so — a release is not a reasonable default interpretation of "ship it"
or "we're done".

Read `AGENTS.md` and `CLAUDE.md` first. If the requested release cannot be completed safely,
report the blocker and stop rather than improvising a partial one.

## The instrument

`scripts/cut-release.mjs`, through `npm run release:cut`. It deliberately operates on the
fetched `origin/main` — not the current worktree or local `HEAD` — and it never commits or
deploys.

1. `npm run release:cut -- --prepare` (optionally `--since` or `--days`) gathers the
   already-live source material and the canonical card names.
2. In **one** model call, author the output JSON: the alliterative card name, detailed GitHub
   notes, and a warm player-facing Buttondown subject/body. Save that response to a file.
3. Review without mutation: `npm run release:cut -- --draft <file> --dry-run`.
4. When the name and both note tiers are honest: `npm run release:cut -- --draft <file>`.

If `--since` or `--days` was used during preparation, pass the same selector to the dry-run and
the real command — the saved draft is bound to that exact source SHA and range.

The real run verifies the same source SHA is still `origin/main` and live, creates or verifies
the tag, writes the app's copy of the release into `apps/web/src/data/releases.json`, creates
the GitHub release, and creates the Buttondown email with `status: draft`. Rerunning the same
draft is idempotent. To retry only one failed channel: `--channel github` or `--channel email`.

Use a Buttondown API key with `email_access=write` and `sending_access=none` when one is
available. The tool never calls a send endpoint or advances an email beyond `draft`.

## Every run

1. Confirm Jamie explicitly requested this release. Otherwise stop.
2. Fetch `origin/main` and tags. Ignore unrelated local commits and working-tree changes; never
   push them. Verify the exact remote commit has a successful deploy and is the build
   production actually reports.
3. Gather changes since the latest reachable release tag — or, when no tag is reachable, since
   the most recent entry in `releases.json`. Coin an apt alliterative canonical Clash Royale
   card name, and write accurate GitHub notes and a player email per "The player email" below.
4. Dry-run first. Check the name, range, build hash, detailed notes, Buttondown subject/body,
   newsletter context, and planned actions. Read the email against "The player email" below
   before accepting it — that is the check that is easiest to skip and most expensive to get
   wrong, because Jamie's next action is to send it.
5. Run the real cut. The tag must point to the verified live SHA. The GitHub release uses the
   detailed notes. Buttondown holds a draft only — never `about_to_send`, `scheduled`, or
   `sent`.
6. Report the release URL and the Buttondown draft ID. Jamie owns review and sending.
7. Confirm the only worktree change is the `apps/web/src/data/releases.json` entry the tool
   wrote. Report it; Jamie owns committing it.

## The player email

The two note tiers are **not** the same document at two lengths. The GitHub notes are a record
for whoever needs to know what changed. The Buttondown body is a letter to people who play the
game, and it must arrive **ready to send** — Jamie's review is a read-through, not a rewrite.
A draft that summarises only the headline features and buries the rest in a closing clause is
not finished work.

Write it so a player finishes it knowing everything that changed *for them*:

- **Every player-visible change in the range gets its own sentence.** A feature that took a
  week does not get four words at the end of a paragraph.
- **Changes to game facts are called out explicitly, never folded into a list.** A card's
  elixir cost changing, a mode's lives or curve changing, a score or rank being recomputed —
  a player has memorised these. Say what changed and what it used to be.
- **Say what a fix means, not that a fix happened.** "Dropped taps on the iOS keypad are
  fixed" beats "various stability improvements".
- **Name the surfaces.** Clan rankings, the profile, the boards, the badge wall: a player
  should be able to find each thing you mention.
- **Leave out anything that is not player-visible.** Internal tooling, observability,
  refactors, test infrastructure, deploy hardening, and private operator surfaces belong in
  the GitHub notes only.
- Keep the warmth and the plain voice. Short paragraphs with bold leads, not a changelog.
- End with the link.

When a range is long enough that the email cannot carry it, that is a signal the release is
overdue — raise it with Jamie rather than compressing the letter until it says nothing.

## releases.json

`releases.json` is the only file a cut touches, and **the tool writes it** — from the same card
name and player-facing notes already authored — so the in-app `/releases` page stays current
without anyone hand-editing it. During a cut, never write that file by hand, and never commit
it yourself; the backfill below is the one edit made outside the ceremony, and Jamie triggers
that too.

Its `beta: true` entries are backfilled history: real builds that really went live, but were
never named or mailed at the time. A cut never sets that flag, and never rewrites those
entries.

Backfilling betas is a **separate, deliberate act, never part of a cut** — an ordinary commit
that adds entries by hand, the way `24ab005` did. It is the right move when a long gap between
named releases would otherwise collapse months of real work into one entry. Every backfilled
entry is anchored to a commit that genuinely went live and deployed, carries `beta: true`, and
gets no tag, no GitHub release, and no email. Only Jamie decides to backfill.

## Hard rules

- Jamie is the only release trigger.
- Release only the exact fetched commit that is already live.
- Never commit or push `main` as part of a release. The tool writing `releases.json` into the
  worktree is not a commit.
- Never open a release-tracking issue.
- Never send or schedule release email. Buttondown status is always `draft`.
- Never read player addresses or construct a recipient list. The Drop newsletter owns its
  subscribers, unsubscribes, suppression, batching, and eventual delivery.
- Never build or fix product code, decide release timing, hand-maintain a release file, deploy,
  or post to Discord as part of a cut.
- A channel failure is reported directly to Jamie. A retry uses the same saved draft and tag;
  never invent a second release to recover a partial one.

Success is intentionally boring: Jamie asks, one aptly named GitHub release appears on the
already-live build, one Buttondown draft is ready to send as written, and nothing else
changes.
