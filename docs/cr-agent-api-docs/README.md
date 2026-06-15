# Clash Royale API Agent Reference

This folder is an agent-first documentation set for the public Clash Royale API
at `https://api.clashroyale.com/v1`.

It is designed for agentic use: LLM agents, coding agents, automation workflows, and API clients that need a practical, accurate reference for live endpoint behavior rather than a thin endpoint list.

In Elixir Drop, this is reference material for `scripts/refresh-cards.mjs` and
API assumptions. It is not the product spec; use the root `README.md`,
`SPEC.md`, `GAMES.md`, and `CLAUDE.md` for the app itself.

## What This Provides

- A structured reference for the documented Clash Royale API surface area
- Endpoint-by-endpoint notes on parameters, response shapes, pagination, caching, and error behavior
- Field-level model references based on live API responses
- Coverage of known quirks, broken endpoints, removed endpoints, and inconsistent behaviors
- Cross-links between related resources such as players, clans, river race, locations, rankings, tournaments, cards, events, and leaderboards

## Intended Use

This repo is written to be consumed by agents as much as by humans.

That means it emphasizes:

- Deterministic endpoint descriptions
- Observed response schemas
- Edge cases and failure modes
- Notes about deprecated or misleading API behavior
- Practical implementation details an agent can use when generating code, tools, tests, or integrations

If you are building an autonomous or semi-autonomous client, this collection is meant to reduce guesswork.

## Recommended Agent Workflow

If an agent is using this repo to answer questions, generate integrations, or validate API behavior, the recommended order is:

1. Start with [index.md](index.md) for common API rules, global caveats, and endpoint discovery.
2. Open the domain file for the target surface area such as [players.md](players.md) or [clans.md](clans.md).
3. Use [models.md](models.md) to validate field presence, optionality, and shared object shapes.
4. Prefer observed behavior notes over generic assumptions, especially for pagination, error payloads, and older endpoints.
5. Treat endpoints marked broken, disabled, or removed as operational constraints, not temporary noise.

The intended opinionated use is simple: agents should treat this repo as a live-behavior reference, not just a static API catalog.

## Reference Anchor

For clan-based examples and verification, this documentation uses the POAP KINGS clan tag:

- `#J2RGCRVG`

Remember that Clash Royale tags must be URL-encoded in paths:

- `#J2RGCRVG` → `%23J2RGCRVG`

## Contents

- [index.md](index.md): master index and common API behavior
- [players.md](players.md): player profiles, battle logs, upcoming chests
- [clans.md](clans.md): clan detail, members, river race, clan search
- [locations.md](locations.md): locations, rankings, seasons, Path of Legend
- [leaderboards.md](leaderboards.md): game-mode leaderboards
- [tournaments.md](tournaments.md): player-created tournaments
- [globaltournaments.md](globaltournaments.md): global tournaments
- [cards.md](cards.md): card catalog and support items
- [events.md](events.md): current live events
- [challenges.md](challenges.md): challenge endpoint status
- [models.md](models.md): shared response model reference
- [fan-content-policy.md](fan-content-policy.md): Supercell fan content constraints

## Status

The docs in this repo are intended to reflect live behavior, including places where the API is inconsistent, partially broken, or no longer maintained cleanly.

Use [index.md](index.md) as the starting point.
