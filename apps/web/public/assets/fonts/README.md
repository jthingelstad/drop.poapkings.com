# Font — Supercell Fan Content

The `.otf` files here are **Supercell's official "Clash" display font**, obtained from
the Supercell Fan Kit and used as fan kit assets under Supercell's Fan Content Policy.

- Font: **Clash**, © 2016 Supercell, designed by John Roshell (Comicraft).
- "Clash" is a trademark of Supercell.
- Source: Supercell Fan Kit — <https://fankit.supercell.com/> (Clash Royale fonts).

Weight present:

| File | Weight |
| --- | --- |
| `Clash_Regular.otf` | Regular |

**Regular** is wired up by the `Clash Royale` `@font-face` in
`apps/web/src/styles.css` and the OG-image render script. Unused weights are not
shipped in the public bundle.

> This material is unofficial and is not endorsed by Supercell. For more information
> see Supercell's Fan Content Policy: <www.supercell.com/fan-content-policy>.

## Why this file lives in the repo

The font is served locally (bundled with the site's static assets) so the display
typeface renders reliably without a runtime dependency on a third-party CDN, and so it
is available to canvas/WebGL text rendering, which requires same-origin resources.

## Compliance notes

- The font is used **unmodified**. It is referenced via `@font-face` in
  `apps/web/src/styles.css` (family `Clash Royale`) and by the OG-image render script;
  the file itself is not altered. The policy prohibits modifying Supercell Assets.
- This is a **non-commercial fan project** (a Clash Royale elixir-cost learning app).
  No fees are charged.
- History: this repo previously shipped a third-party lookalike font ("Supercell Magic"
  © Active Images, 2009) that is **not** a genuine Supercell asset. It was replaced with
  this official Fan Kit font so the app uses only authentic, policy-covered Supercell art.

We acknowledge Supercell's ownership of this font and believe this use is within the Fan
Content Policy. Supercell may revoke this permission at any time; if asked, we will
remove this asset.
