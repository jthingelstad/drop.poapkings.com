# Elixir Drop — Build-Out Prompts for Claude Code

Paste one prompt at a time; review at each checkpoint before moving on. These
assume Claude Code still has `CLAUDE.md` and `SPEC.md` loaded. Prompt 1 was the
kickoff (scaffold + Pages plumbing + `refresh-cards.mjs` + seed `cards.json` +
Practice mode). Continue from there.

Only one prompt carries a decision: **Prompt 3 (Surge)** defaults to golf-time
scoring — change that line if you want points instead.

---

## Running these in the cloud (laptop off)

Use **Claude Code on the web** (claude.ai/code) so the build-out runs on
Anthropic's infrastructure, async, with PRs to review from anywhere.

- Connect the GitHub repo at claude.ai/code. **Each prompt below = one cloud task
  = one PR.** The "stop and show me" checkpoint becomes the PR review: merge it,
  then kick the next prompt (from the browser or the mobile app). Keep them serial
  — each builds on the last.
- **One-time sandbox setup:** add a setup step that runs `npm install`
  (sessionStart hook) and allowlist the npm registry in the sandbox's network
  config so it can install deps and run the build. Configure both at claude.ai/code
  — see https://code.claude.com/docs/en/claude-code-on-the-web
- **Stays on your host (do not move to cloud):** `scripts/refresh-cards.mjs`. It
  needs the IP-allowlisted CR token on your registered IP; the cloud sandbox has a
  different IP and no token by design. Cloud only ever builds against the committed
  `cards.json`. Keep the cron refresh local.
- **Caveats:** cloud sessions share your plan's rate limits (parallel = more);
  GitHub-only; and if your Claude account is under an org with IP allowlisting,
  cloud sessions fail until Anthropic exempts its hosted services — check this if
  your account is SPS-governed rather than personal.
- The prompts work verbatim in the cloud; "show me" simply resolves to the PR.

---

## Prompt 2 — Persistence + weighted sampling

```
Wire persistence and the learning engine into Practice, per SPEC §5 and §9.
- Implement src/lib/storage.ts as the single seam for all progress (profile,
  cardStats, records, funnel, settings) using the elixirdrop: localStorage prefix.
  Nothing else may touch localStorage directly — everything goes through it.
- Implement src/lib/sampling.ts (weighted SRS-lite): surface missed cards more,
  fade mastered ones, recency penalty to avoid immediate repeats, clamp floor;
  tunables in one config object.
- Update Practice to select cards via the sampler and record each result
  (seen/correct/missStreak/lastSeen) through storage.
- Persist a basic profile (createdAt, totalSessions) and a settings object.
Checkpoint: play ~20 cards, miss a few on purpose, reload — confirm missed cards
recur more often and stats survive the reload. Stop and show me.
```

## Prompt 3 — Surge (the speed game)

```
Build Surge per SPEC §4.2. Scoring is golf time (elapsed + penalties; lower wins)
unless I say otherwise.
- Input: the 1–10 pip keypad (not multiple choice).
- A sprint of SURGE_SPRINT_LEN (15) cards selected via the weighted sampler.
  Preload all sprint card images before the timer starts (a brief "Get ready" beat).
- Use performance.now() for timing. Correct → drop animation + instant next card.
  Wrong → red flash, +2.0s penalty (SURGE_PENALTY_MS), card stays until correct.
- Capture per-card split times. Score = total elapsed incl. penalties. Store
  surgeBest in records via storage; detect a new PB.
- Keep Elixir silent during the run; reactions come on the summary.
- Put Surge tunables in one config object.
If there's no home/mode-select screen yet, add a minimal one so Practice and Surge
are both reachable.
Checkpoint: run a sprint — verify the timer is honest, the penalty behaves, images
don't pop in mid-run, and a new PB persists across reload. Stop and show me.
```

## Prompt 4 — Summary + insight layer

```
Build the post-session summary screen, shared by Practice session-end and
Surge-end, per SPEC §5 (insight layer) and §6.
- Compute: accuracy by cost band (1–2 / 3–4 / 5+), weakest cards, and a directional
  bias read ("tends to overestimate spells by ~1"). For Surge, also compute slowest
  cards / slowest band from the split times.
- Elixir delivers ONE line from the static line table (surge_done / session_end),
  interpolating {time}/{accuracy}/{insight}.
- Show the headline number (Surge: "15 cards · 28.6s", with a PB callout if beaten).
Checkpoint: finish a Practice session and a Surge sprint; confirm the summaries
compute sensibly and Elixir's line fits. Stop and show me.
```

## Prompt 5 — Higher / Lower

```
Build Higher/Lower per SPEC §4.3.
- Show two cards from the sampler; player picks Higher, Lower, or Equal (relative
  to the left card).
- Immediate feedback; track a simple streak and persist longestStreak via storage.
- Wire it into the home/mode-select screen.
Checkpoint: play a run, confirm Equal works and the streak persists. Stop and show me.
```

## Prompt 6 — Tinylytics + shareable result

```
Wire analytics and sharing per SPEC §7. This game uses its OWN Tinylytics property
(site ID JjqvUeyEnrPM1f_iXrbU) — do not couple to poapkings.com's metrics.
- Add the Tinylytics embed to <head> with that ID.
- Adopt the .starcount pop/spark/+1 animation, driven by THIS game's hit count
  (a self-contained "Drop Stars" counter).
- Fire custom events via data-tinylytics-event across the funnel: game.start,
  mode.practice, mode.surge, mode.higherlower, surge.complete, record.new,
  recruit.shown, recruit.join, recruit.discord, result.share.
- Add a kudos control on the summary screen.
- Add a copyable share line on the Surge summary: "Surge: 15 cards in 28.6s —
  drop.poapkings.com". Pure text, no backend. Mirror counts to the local funnel too.
Checkpoint: confirm events fire and the star counter animates on a hit. Stop and show me.
```

## Prompt 7 — Recruitment funnel

```
Build the recruit funnel per SPEC §7 — moments, not chrome. No load-time modal,
no nagging.
- Trigger only on an earned moment: a new Surge PB, or a strong completed session.
  Elixir delivers a record/recruit line + a SINGLE CTA.
- Mirror the site's JOIN/WAIT pattern: the clan is often full, so lead with the
  Discord invite when full; otherwise the clan-invite link. URLs are in CLAUDE.md.
- Add a quiet, always-present footer: "Run by POAP KINGS" linking out.
- Record recruit impressions/clicks in the local funnel + matching Tinylytics events.
Checkpoint: trigger a PB and confirm the ask appears once, after the win, with one
clear CTA. Stop and show me.
```

## Prompt 8 — Polish, accessibility, assets

```
Polish pass per SPEC §8 and the build order.
- Honor prefers-reduced-motion on ALL celebratory FX (drop, streak, star pop);
  Surge keeps the timer + red-flash either way.
- Add a sound toggle (sounds optional, off by default) and a settings screen.
- Mobile-first and responsive — the pip keypad must be thumb-friendly; the board
  sits in a calm centered column.
- Add favicon + an OG/share image slot, and the Supercell fan-content disclaimer
  in the footer.
- Leave a clearly marked slot for the real Elixir avatar (+ optional expression
  states); placeholder is fine until I supply art.
Checkpoint: test on a narrow viewport and with reduced-motion on; confirm no
console errors. Stop and show me.
```

## Prompt 9 — Go-live check (before first deploy)

```
Pre-launch verification. Don't change features; verify and report.
- npm run build succeeds; dist/ references the committed cards.json only and
  contains NO token or secret.
- The deploy workflow needs no secrets; public/CNAME and Vite base:'/' are correct;
  hash routing works from a fresh load (no 404s).
- All storage access goes through storage.ts; the elixirdrop: prefix is consistent.
- Reduced-motion and the text-chip image fallback both work.
Report anything off; fix only build/correctness issues, not scope.
```

---

## Optional / later (stretch modes, SPEC §4.4)

```
Build one stretch mode at a time, on request, each opt-in and separate, each with
its own checkpoint:
- Blitz — a 60s count-up variant of Surge ("how many correct").
- Survival — sudden-death endless run.
- Deck Budget — pick 8 cards to hit a target average elixir; scored on closeness.
- Focus — drill a subset: spells only, buildings only, or a weak cost band.
```

---

### Between milestones — useful one-offs

- After your first real `refresh-cards.mjs` run on the host:
  `"The real cards.json is committed now. Confirm the game reads it cleanly, the
  count looks right (~121), and nothing was hardcoded against the seed."`
- If a checkpoint reveals jank:
  `"Before adding anything new, tighten <the thing>: <what felt off>. Keep scope to
  that fix."`