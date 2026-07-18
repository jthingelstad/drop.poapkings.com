# Card Rendering Reference

This note captures the reusable card-rendering rules for Elixir Drop. It is based
on the local Clash Royale screenshots in `docs/clash-royale-screenshots/`:

- `example-collection1.png`
- `example-collection2.png`
- `example-goblin-cage.jpg`
- `example-hunter.jpg`
- `example-inferno-tower.jpg`
- `example-magic-archer.jpg`

## Reference Findings

Clash Royale collection cards use a compact visual grammar:

- The elixir cost sits on the upper-left corner in a bright magenta circular
  badge.
- Card art is framed by a heavy dark bevel with a rarity-colored top cap or gem.
- Readable card text is on the lower part of the card face, with thick black
  outline/shadow.
- The reference screenshots show card level text rather than card names on most
  grid cards. The level text color changes by rarity/upgrade context: common
  reads blue, rare reads orange/gold, epic reads purple/pink, legendary reads
  teal/mint, and champion should read gold.
- Selected cards show the actual card name in white over the art, then a colored
  level band beneath it.

Elixir Drop does not have player-owned card levels, so the app should not render
fake level labels. Instead, card names use the same color language to carry the
rarity signal.

## Implementation

Shared card rendering lives in:

- `apps/web/src/lib/card-rendering.ts` for rarity labels, rarity modifier classes, and
  name-tone mapping.
- `apps/web/src/components/CardChrome.tsx` for reusable `CardArt`, `CardName`, and
  `ElixirCostBadge` helpers.
- `apps/web/src/styles.css` for the shared `cr-card-art`, `cr-card-name`, and
  `cr-elixir-badge` classes.

The current rarity-to-name-tone mapping is:

| Rarity    | Tone          |
| --------- | ------------- |
| Common    | Blue          |
| Rare      | Orange / gold |
| Epic      | Purple / pink |
| Legendary | Teal / mint   |
| Champion  | Champion gold |

Mode-specific classes such as `pcard__name`, `ladder-card__cost`,
`trade-card__name`, and `sweep-card__cost` remain in place for layout and tests.
They should be paired with the shared helpers rather than rebuilt by hand.

## Usage Rules

- Use `CardArt` whenever a mode renders card art, even if the mode owns the outer
  layout.
- Use `CardName` for any visible card name, including list rows and summary chips.
- Use `ElixirCostBadge` when a card cost is revealed. If a game hides cost as
  part of the mechanic, do not render the badge until reveal.
- Do not add card-level text unless Elixir Drop later gains real player-level
  data.
- Keep card names on-card or in a reserved text lane. Names should never sit
  visually underneath the card art by accident.
