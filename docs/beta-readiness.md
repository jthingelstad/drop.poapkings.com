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

This gate fails on high-severity dependency findings, formatting or lint errors,
TypeScript errors, dead files or dependencies, coverage regressions, Chromium,
WebKit or iPhone browser failures, build failures, a mismatched or unsettled AWS
stack, invalid production CORS, anonymous gameplay, masked-email acceptance, a
stale Clash Royale season clock, a broken Fastmail JMAP credential, or a website
that points at the wrong API.

Do not deploy around a failed gate. Fix the failure or make a deliberate,
reviewed change to the gate itself.

## 2. Deployment and automatic rollback boundary

Push the reviewed commit to `main`. The `Build and Deploy` GitHub Actions run
must finish successfully. It verifies the whole monorepo, deploys and smokes the
API, rebuilds the web app against that API, and then deploys GitHub Pages. A
failed API update blocks the website deployment.

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
- Confirm the daily mail canary arrived at `elixir@poapkings.com`. The alarm is a
  failure signal, but seeing a recent message proves the mailbox side too.
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

Use a disposable account once per release candidate to verify account deletion:
type `DELETE`, confirm the account disappears, and verify its prior runs no
longer appear in its history or leaderboards. The anonymous site-wide Trophy
Road total intentionally does not decrement.

## 5. Device and accessibility spot check

The automated suite covers Chromium, WebKit, and an iPhone-sized viewport. Also
perform a short real-device check on current iPhone Safari and one desktop
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

## 7. Anti-cheat: reject, don't review

Score integrity is enforced by outright rejection, not a review queue.
`services/api/src/integrity.ts` recomputes every completion and rejects an
implausible or impossible run with `400 integrity_rejected`: it is neither
recorded nor credited, and the started-run row is left to TTL-expire on its own
(exactly like a scorer reject). There is no quarantine partition and nothing to
review by hand. Watch CloudWatch for the `Run completion rejected by integrity
check` warnings — a cluster of them signals either a shipped UI limit that is too
tight or a probing client.

The completion and public read endpoints are also IP rate-limited
(`/runs/complete` at 300/hour; a shared `reads` scope over `/leaderboards`,
`/stats`, and `/seasons` at 1200/hour, deliberately generous so a shared NAT
does not trip it). A `429 rate_limited` in the logs is the expected response to
abusive volume, not a fault.
