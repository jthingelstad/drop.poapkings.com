import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'public/assets/og-image.png')
const elixir = await readFile(path.join(root, 'public/assets/elixir-og.png'))
const font = path.join(root, 'public/assets/fonts/SupercellMagic.ttf')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.setContent(`
<!doctype html>
<html>
  <head>
    <style>
      @font-face { font-family: "Supercell Magic"; src: url("file://${font}") format("truetype"); }
      * { box-sizing: border-box; }
      body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #070610; font-family: "Supercell Magic", system-ui, sans-serif; color: #f7f4ff; }
      .card {
        position: relative; width: 1200px; height: 630px; overflow: hidden;
        background:
          radial-gradient(900px 560px at 12% 0%, rgba(109, 40, 217, 0.55), transparent 60%),
          radial-gradient(760px 480px at 92% 18%, rgba(245, 200, 76, 0.26), transparent 58%),
          radial-gradient(850px 540px at 50% 100%, rgba(109, 40, 217, 0.25), transparent 65%),
          linear-gradient(180deg, #070610, #0b0920);
      }
      .frame { position: absolute; inset: 54px; border: 6px solid rgba(255,255,255,0.10); border-radius: 30px; box-shadow: 0 24px 80px rgba(0,0,0,0.45); }
      h1 { position: absolute; left: 84px; top: 138px; margin: 0; font-size: 78px; letter-spacing: 0; text-shadow: 0 10px 40px rgba(0,0,0,0.5); }
      p { position: absolute; left: 88px; margin: 0; color: #d7c8ff; font-size: 34px; line-height: 1.35; }
      .sub { top: 274px; max-width: 570px; }
      .by { top: 382px; color: #f5c84c; font-size: 31px; }
      img { position: absolute; right: 112px; top: 110px; width: 390px; height: 390px; object-fit: contain; filter: drop-shadow(0 24px 42px rgba(0,0,0,0.45)); }
      .drop { position: absolute; right: 464px; top: 116px; width: 52px; height: 70px; background: linear-gradient(180deg, #f5c84c, #c98c10); border-radius: 50% 50% 55% 55%; transform: rotate(180deg); box-shadow: 0 0 34px rgba(245,200,76,0.42); }
      .drop::before { content: ""; position: absolute; left: 0; top: -31px; border-left: 26px solid transparent; border-right: 26px solid transparent; border-bottom: 38px solid #f5c84c; }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="frame"></div>
      <span class="drop"></span>
      <h1>Elixir Drop</h1>
      <p class="sub">learn Clash Royale elixir costs</p>
      <p class="by">run by POAP KINGS</p>
      <img src="data:image/png;base64,${elixir.toString('base64')}" alt="">
    </main>
  </body>
</html>`)
await page.screenshot({ path: out, type: 'png' })
await browser.close()
console.log(`wrote ${path.relative(root, out)}`)
