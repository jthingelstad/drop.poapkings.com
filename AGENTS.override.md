# Elixir Drop: Codex entry point

This concise entry point keeps the instruction chain within Codex's document
budget. `AGENTS.md` remains the architecture and product reference; read its
relevant sections and the documents below before changing the affected surface.
This entry point does not grant new product or production-write authority.

## Start here

- Scheduled owners read `AGENT-TEAM/WORKFLOW.md`, `AGENT-TEAM/README.md`, their
  objective, and the generated `AGENT-TEAM/SCHEDULE.md` completely.
- `CONTRIBUTING.md` owns local setup, fixtures and change-specific final gates.
  Use `npm run verify:non-browser` for agent definitions, tooling and prose;
  follow its matrix for browser/runtime changes. Node 24 is authoritative.
- `AGENTS.md` owns the document map, golden rules, architecture and approved
  product decisions. `SPEC.md` owns implementation; `GAMES.md` owns game rules.
- Read the API, Control Room or infrastructure README when that boundary changes.

## Working agreement and authority

Measure current evidence; a healthy no-op is success. Run preflight before work.
Dirty, ahead, behind, detached or leased checkouts allow safe reads only. Claim
the objective lease before mutation; recheck it before editing and pushing.
Never stash, reset, overwrite, or publish another worker's changes. Commit only
current-run work to `main`, run the canonical final gate, verify the exact CI
result and affected deployment, then release from a clean checkout.

Jamie decides new modes, material scoring/season rules, privacy-affecting
collection, Free Pass recipient/prize action, public enforcement, broad
communication outside the standing Updates contract, irreversible changes and
significant product direction. Preserve the existing source-backed season
publication and material player-Update rules in `AGENTS.md` and WORKFLOW.
These agent-definition changes do not warrant a player Update.

## Invariants that apply before reading deeper

- Keep web, admin, API, contracts and infrastructure boundaries explicit.
  Never import service implementation across workspaces.
- Runtime CR context comes from the current Elixir Integration REST contract;
  read `AGENTS.md`'s final integration section and the canonical MCP integration
  docs. Do not restore the retired CR bridge or direct runtime Supercell calls.
  The manual host-only card refresh is a separate documented exception.
- Secrets never enter context, source, browser builds or CI output. Follow the
  parent secret-safety rules. No CR credential belongs in Lambda or the browser.
- Public web remains private S3 plus CloudFront; the Control Room stays private.
  Vendor approved visual assets; retain the Supercell attribution/disclaimer.
- API-owned challenges, scoring, learning, XP and account state stay server-owned.
  Official and offline runs remain distinct; never upload/replay offline results.
- Referee signals are review evidence, not verdicts. Use sanctioned pseudonymous
  referee tools and reversible decision overlays; never edit canonical scores,
  expose raw identity/telemetry, or apply player-level enforcement without authority.
- Never create accounts, guest/recorded runs, emails, leaderboard entries or
  referee cases merely for acceptance. Local Vite normally targets production:
  interactive QA needs verified mocked API fixtures or offline isolation.
- Technical success is separate from natural player acceptance. Keep outstanding
  evidence in compact Current state / Active watches / Latest run; never invent it.

Use the shared HEALTHY / CHANGED / WATCHING / BLOCKED / NEEDS JAMIE closeout.
