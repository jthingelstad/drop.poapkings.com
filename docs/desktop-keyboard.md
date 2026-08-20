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

On initial load at 1024px and wider, the app uses a fixed 936 × 720 shell.
Navigation and the activity rail stay anchored around a fixed 440px center
stage. Home uses the same sequence as mobile — featured game, the other four
ranked games, then Practice — with no duplicated featured mode. Game routes
remove the rails, use a fixed 480 × 720 stage, and retain the advanced
three-layer Falling Cards scene. Later browser resizing never swaps or reflows
the desktop interface; a smaller viewport clips it.

The persistent scene keeps a 30-card texture cast and swaps six cards every 20
seconds so the full catalog rotates through over time. Reduced motion freezes
the composition. The desktop control cycles ambient -> full screen -> off ->
ambient. Full screen hides the game panels over the same running background;
the dismissing input restores the panels with cards off, and the next press
deals the ambient scene back in.
