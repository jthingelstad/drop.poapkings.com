# Desktop keyboard support

Status: **implemented August 20, 2026.**

Desktop is a complete play surface. The five ranked modes mount directly on
mouse-only and keyboard devices and submit to the existing mode leaderboards;
there is no input-class split or board epoch. Practice remains unranked.

## Advertised mapping

| Cost | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Home row | `A` | `S` | `D` | `F` | `G` | `J` | `K` | `L` | `;` |
| Alias | `1` | `2` | `3` | `4` | `5` | `6` | `7` | `8` | `9` |

`PipKeypad` and Practice's four-choice scaffold bind the card's elixir cost,
not a button position. Digits or home-row keys whose cost is not offered do
nothing.

Trade mirrors its physical two-lane pad: `A/S/D/F` are Blue +1…+4, `G` is Even,
and `J`–`;` are Red +1…+4. The legacy numeric aliases remain: 1–4 Blue, 5 or 0
Even, and 6–9 Red. Higher / Lower uses `↑`/`↓`; `←`/`→` remain aliases.

## Default and navigation actions

- `Space` is the default action on a completed summary and retry screen. On a
  summary it starts another run, enabling a repeated Surge loop without leaving
  the home row. During a question or countdown it does nothing except prevent
  the fixed game viewport from scrolling.
- `Escape` during active play focuses the quit button. A deliberate second
  press abandons the run. Clicking the visible quit button remains immediate.
- `?` opens the compact desktop controls sheet; Escape closes it.
- Focus moves to the summary heading when a run completes. Native Tab/Enter/
  Space behavior remains intact for explicitly focused buttons and links.

Every global game binding ignores modifier chords, repeated keydown events,
text fields, textareas, and editable content. Visible keycap labels and the
desktop navigation card advertise the home-row layout; Game Setup carries the
same public reference.

## Desktop composition

At 1024px and wider, the app uses a bounded `100dvh` shell. Navigation and the
activity rail stay anchored while the center stage owns any necessary internal
scroll. Home fits all six game entries at the 1280×720 acceptance viewport.
Game routes remove the rails, keep a wider fixed-height stage, and retain the
CSS Falling Cards background. Reduced motion freezes that background rather
than removing it.
