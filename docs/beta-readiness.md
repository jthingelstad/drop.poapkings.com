# Public beta readiness

Use this checklist before inviting a new group of players. The goal is a small,
observable rollout with a quick way to stop if authentication, game recording,
or the Clash Royale bridge is unhealthy.

## 1. Automated release gate

From the fixed-IP Elixir Drop host, on Node.js 24 and a clean `main` checkout:

```bash
npm ci
npm run check:beta
```

`check:beta` is `npm audit --audit-level=high` + `npm run verify` +
`npm run smoke:api`. It fails on high-severity dependency findings, formatting or
lint errors, TypeScript errors, dead files or dependencies, coverage regressions,
a Chromium / Firefox / WebKit / iPhone-14 browser failure, build failures, a
mismatched or unsettled AWS stack, invalid production CORS, anonymous gameplay,
masked-email acceptance, a stale Clash Royale season clock, a broken Fastmail JMAP
credential, or a website that points at the wrong API. (`CONTRIBUTING.md` →
"The quality gate" is the canonical description of the `verify` half.)

Do not deploy around a failed gate. Fix the failure or make a deliberate,
reviewed change to the gate itself.

## 2. Deployment and automatic rollback boundary

Push the reviewed commit to `main`. The `Build and Deploy` GitHub Actions run
must finish successfully. It runs the same quality gate as step 1, deploys and
smokes the API, rebuilds the web app against that API, and then deploys GitHub
Pages. A failed API update blocks the website deployment.

If the deployed app is unsafe for players, stop sending invites and revert the
offending commit on `main`. The same pipeline will deploy the prior application
state. Do not delete the DynamoDB table or CloudFormation stack as a rollback.

## 3. Operator checks

- Confirm the `elixir-drop` CloudFormation stack is settled and the alarm email
  subscription has been confirmed.
- Confirm all `elixir-drop-*` CloudWatch alarms are `OK`, or understand any
  current `INSUFFICIENT_DATA` state before inviting players.
- Confirm the local launch agent is running:
  `launchctl print gui/$(id -u)/com.poapkings.elixir-drop-cr-bridge`.
- Inspect the latest bridge log entries in
  `~/Library/Logs/elixir-drop-cr-bridge.log`; a war-clock relay should appear at
  least every five minutes and there should be no repeating error loop.
- Confirm the private Discord `#drop-log` received the latest bridge start or
  restart message and is receiving compact player-login and completed-game
  events.
- Confirm the daily mail canary arrived at `drop@poapkings.com` from
  `elixir@poapkings.com`. The alarm is a failure signal, but seeing a recent
  message proves the mailbox side and the player-mail sender too.
- Confirm DynamoDB point-in-time recovery remains enabled. This protects the
  service data; it is not a reason to skip account-deletion testing.

## 4. One real player journey

Use a normal browser session and an email address that is not already signed in:

1. Try a masked address such as `e***@p***.com`; the page must reject it without
   sending mail.
2. Request a link for the real address, open it once, and confirm replaying the
   same link fails safely.
3. Choose a favorite card and generated name, then play one Surge run.
4. Confirm the result leaves the reconnecting state, increments the player's
   games exactly once, and appears on the current seasonal leaderboard.
5. Confirm Trophy Road advances exactly once. Refreshing the page must not
   change it.
6. Attach a Clash Royale tag. Confirm clan, account age, and card collection
   appear without trophies, arena, experience level, or card levels.
7. Sign out and back in. Confirm that login queues one player refresh and that
   ordinary page loads do not keep refreshing the tag.
8. Confirm the private Discord log has compact login, CR-load, and completed-game
   lines with the public player name but no email address.
9. Share that Surge run. Confirm the sheet carries a rendered card **and** a
   `#/r/<token>` link, that the link opens the run itself with the score as the
   button, and that sharing the same run again produces a different token.
10. Open your own link and confirm it credits nothing, then open it from a second
    device or network and confirm it counts once and only once on a refresh.
11. Play one offline or guest run and confirm the summary offers **no** share
    control at all — absent, not disabled.

Use a disposable account once per release candidate to verify account deletion:
type `DELETE`, confirm the account disappears, and verify its prior runs no
longer appear in its history or leaderboards. The anonymous site-wide Trophy
Road total intentionally does not decrement.

## 5. Device and accessibility spot check

The automated suite covers Chromium, Firefox, WebKit, and an iPhone-14 viewport.
Also perform a short real-device check on current iPhone Safari and one desktop
browser:

- sign in from the email link;
- play Surge and one non-timed mode;
- open and dismiss Trophy Road with the button, outside click, and Escape on
  desktop;
- verify no horizontal scrolling, covered controls, or card-art framing; and
- use keyboard-only navigation through login, profile, leaderboard, privacy,
  and account deletion without losing the focus indicator.

## 6. Rollout and observation

Invite a few clan members first. Watch `#drop-log`, CloudWatch alarms, the bridge
log, mail delivery, and player feedback during the first session. Expand only
after at least one fresh login, CR profile load, completed run, leaderboard
entry, and season-clock update have all succeeded in production.

Do not promise a prize until the whole four-week season has run with the
integrity checks and operational monitoring in place.

## 7. Anti-cheat: preserve evidence and review signals

The server recomputes every completion from its signed challenge. When
assumption-based timing or transcript checks produce a deterministic candidate
score plus review signals, the ranked run is recorded and sent to the referee
under the Awaiting seal — and it **still ranks provisionally on the public
board** while it waits. Only an `excluded` run leaves a board. The one read that
withholds a pending run is `seasonPodiumFinishers`, because a provisional
placement is reversible and a finalized podium is not. The Fair Play Referee can
later clear a falsely flagged run or exclude a suspect one through an audited,
reversible decision; the automatic label is a review signal, never a verdict.

If no comparable score can be derived, the attempt remains unscored and cannot
be placed on a leaderboard. Its sanitized evidence is retained for review
without inventing a result. Practice and guest runs do not write referee
evidence. Watch CloudWatch review-signal and unscored-attempt warnings for a
cluster that may indicate either a shipped UI/scoring mismatch or a probing
client, then use the bounded referee scripts to inspect it.

The completion and public read endpoints are also IP rate-limited
(`/runs/complete` at 300/hour; a shared `reads` scope over `/leaderboards`,
`/stats`, and `/seasons` at 1200/hour, deliberately generous so a shared NAT
does not trip it; `share-mint` at 60/hour and `share-open` at 600/hour). A
`429 rate_limited` in the logs is the expected response to abusive volume, not a
fault.

Share links carry their own anti-farm rules, because a reach counter is worth
something to a cheater: opens are deduped per token per visitor through a
peppered one-way hash, the sharer's own device is never credited, and credit
stops at 25 per token. Confirm in step 4 that opening your own link does not move
the counter.
