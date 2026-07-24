# Card Graphics — Supercell Fan Content

The PNG files in this directory are **Clash Royale card artwork owned by Supercell**.
They are used here as fan kit assets under Supercell's Fan Content Policy.

> This material is unofficial and is not endorsed by Supercell. For more information
> see Supercell's Fan Content Policy: <www.supercell.com/fan-content-policy>.

## Why these files live in the repo

These images are served locally rather than referenced from Supercell's / RoyaleAPI's
CDN for two reasons:

1. **Performance** — serving the artwork from our own origin removes a third-party
   request on the critical render path and lets us cache and preload it with the rest
   of the app's static assets.
2. **WebGL** — some card visuals are drawn into a WebGL context (textures). Browsers
   block reading pixels from cross-origin images that aren't served with permissive
   CORS headers, which "taints" the canvas and breaks the WebGL rendering. The CDN
   URLs do not reliably return the headers WebGL requires, so the images must be
   same-origin.

## Compliance notes

- The assets are used **unmodified**. We do not alter Supercell's artwork; naming and
  the `_evo` / `_hero` suffixes are our own file-organization convention and do not
  change the images themselves.
- This is a **non-commercial fan project** (a Clash Royale card-drop guide/app). No
  fees are charged for access to these assets.
- The required disclaimer above is displayed to end users in the app UI, not only here.

We acknowledge Supercell's ownership of this artwork and believe this use is within the
Fan Content Policy. Supercell may revoke this permission at any time; if asked, we will
remove these assets.
