# Elixir Drop: Codex entry point

This concise entry point keeps the instruction chain within Codex's document
budget. `AGENTS.md` remains the architecture and product reference; read its
relevant sections and the documents below before changing the affected surface.
This entry point does not grant new product or production-write authority.

## Start here

- Maintainer sessions on Jamie's machine follow `../AGENTS.md` for sessions,
  worktrees and the agent team. Operating the live game is
  `docs/OPERATIONS.md`; the Fair Play rubric is `docs/FAIR-PLAY.md`.
- `CONTRIBUTING.md` owns local setup, fixtures and change-specific final gates.
  Use `npm run verify:non-browser` for agent definitions, tooling and prose;
  follow its matrix for browser/runtime changes. Node 24 is authoritative.
- `AGENTS.md` owns the document map, golden rules, architecture and approved
  product decisions. `SPEC.md` owns implementation; `GAMES.md` owns game rules.
- Read the API, Control Room or infrastructure README when that boundary changes.

## Working agreement and authority

Measure current evidence; a healthy no-op is success. Work on a branch in a
worktree of your own (`scripts/worktree-setup.sh`), never in the main checkout.
Never stash, reset, overwrite, or publish another session's changes. Land only
this session's work as a pull request (`AGENTS.md` → "Landing changes"), run the
canonical final gate, and verify the merge SHA's CI and affected deployment.
A production write from a checkout takes the production lock
(`docs/OPERATIONS.md`); the write scripts take it themselves, and a held lock
means wait, never break it.

Jamie decides new modes, material scoring/season rules, privacy-affecting
collection, Free Pass recipient/prize action, public enforcement, broad
communication outside the standing Updates contract, irreversible changes and
significant product direction. Preserve the existing source-backed season
publication and material player-Update rules in `AGENTS.md` and
`docs/OPERATIONS.md`.
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
