import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'public/assets/og-image.png')
const template = await readFile(path.join(root, 'public/assets/share/og-default.png'))
const font = await readFile(path.join(root, 'public/assets/fonts/Clash_Regular.otf'))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.setContent(`
<!doctype html>
<html>
  <head>
    <style>
      @font-face { font-family: "Clash Royale"; src: url("data:font/otf;base64,${font.toString('base64')}") format("opentype"); }
      * { box-sizing: border-box; }
      body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #070610; font-family: "Clash Royale", system-ui, sans-serif; color: #f7f4ff; }
      .card {
        position: relative; width: 1200px; height: 630px; overflow: hidden;
      }
      .bg { position: absolute; inset: 0; width: 1200px; height: 630px; object-fit: cover; }
      .copy { position: absolute; left: 72px; top: 88px; width: 650px; }
      .eyebrow { margin: 0 0 22px; color: #f5c84c; font-family: Inter, system-ui, sans-serif; font-size: 24px; font-weight: 800; letter-spacing: 0.13em; }
      h1 { margin: 0; color: #f7f4ff; font-size: 100px; line-height: 0.88; text-shadow: 0 10px 42px rgba(0,0,0,0.8); }
      .sub { margin: 34px 0 0; color: #d7c8ff; font-size: 41px; line-height: 1.18; text-shadow: 0 6px 26px rgba(0,0,0,0.9); }
      .url { display: inline-block; margin-top: 38px; padding: 13px 20px 11px; border: 2px solid rgba(245,200,76,0.62); border-radius: 18px; background: rgba(7,6,16,0.74); color: #f5c84c; font-family: Inter, system-ui, sans-serif; font-size: 21px; font-weight: 800; letter-spacing: 0.06em; }
    </style>
  </head>
  <body>
    <main class="card">
      <img class="bg" src="data:image/png;base64,${template.toString('base64')}" alt="">
      <div class="copy">
        <p class="eyebrow">A CLASH ROYALE ELIXIR GAME</p>
        <h1>ELIXIR<br>DROP</h1>
        <p class="sub">Know the cost.<br>Own the clock.</p>
        <span class="url">FREE TO PLAY · DROP.POAPKINGS.COM</span>
      </div>
    </main>
  </body>
</html>`)
// Ensure the @font-face is actually loaded before capturing, otherwise the
// headline silently falls back to system-ui.
await page.evaluate(async () => {
  await document.fonts.load('100px "Clash Royale"')
  await document.fonts.ready
})
await page.screenshot({ path: out, type: 'png' })
await browser.close()
console.log(`wrote ${path.relative(root, out)}`)
