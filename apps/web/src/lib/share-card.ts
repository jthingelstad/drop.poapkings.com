import type { GameMode } from '@elixir-drop/contracts'
import { gameDisplay } from './game-metadata'

// The 1080×1350 run share card.
//
// `share-backdrop.png` is the fixed background and everything else is composited
// on top at export. The centre of the backdrop is intentionally dark and flat,
// so content sits inside it and NO extra scrim is drawn — adding one would
// double up on a gradient the art already has.
//
// Every source is same-origin (`/assets`, `/cards`), so the canvas never
// tainted-flags and `toBlob` stays available. The Clash face is a same-origin
// `@font-face`, so `fillText` can use it — but only after document.fonts says
// it is ready, or the first export silently falls back to a system face.

export const SHARE_WIDTH = 1080
export const SHARE_HEIGHT = 1350

// Bottom-right, ~15% of the card's width (46px on a 300px-wide preview).
const STICKER_RATIO = 0.15

export interface ShareCardInput {
  mode: GameMode
  // Already formatted for humans: "18.4s", "42 cleared".
  score: string
  playerName?: string
  // Per-cost accuracy, drawn as the row of squares.
  bands?: Array<{ label: string; correct: number; total: number }>
  arenaImage?: string
  arenaName?: string
  rank?: number
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

// The compositor draws text in the display face. Without this the first share
// of a session renders in a fallback font, because the face has not been used
// at that size yet.
async function readyFonts(): Promise<void> {
  if (!('fonts' in document)) return
  try {
    await Promise.all([document.fonts.load('700 96px "Clash Royale"'), document.fonts.load('700 44px "Clash Royale"')])
  } catch {
    // A font that will not load is not a reason to refuse the image.
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function playerNameFont(ctx: CanvasRenderingContext2D, name: string): string {
  for (let size = 58; size >= 36; size -= 2) {
    const font = `700 ${size}px "Clash Royale", system-ui, sans-serif`
    ctx.font = font
    if (ctx.measureText(name).width <= 700) return font
  }
  return '700 36px "Clash Royale", system-ui, sans-serif'
}

export async function renderShareCard(input: ShareCardInput): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_WIDTH
  canvas.height = SHARE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const game = gameDisplay(input.mode)
  const [backdrop, sticker, emblem, arena] = await Promise.all([
    loadImage('/assets/share/share-backdrop.png'),
    loadImage('/assets/share/share-sticker.png'),
    loadImage(`/assets/modes/${input.mode}-384.png`),
    input.arenaImage ? loadImage(input.arenaImage) : Promise.resolve(null)
  ])
  await readyFonts()

  // The backdrop IS the background. If it fails to load the card is not worth
  // exporting half-drawn — fall back to the text share instead.
  if (!backdrop) return null
  ctx.drawImage(backdrop, 0, 0, SHARE_WIDTH, SHARE_HEIGHT)

  const centreX = SHARE_WIDTH / 2
  ctx.textAlign = 'center'

  if (emblem) {
    const size = 260
    ctx.drawImage(emblem, centreX - size / 2, 250, size, size)
  }

  ctx.fillStyle = '#d7c8ff'
  ctx.font = '700 46px "Clash Royale", system-ui, sans-serif'
  ctx.fillText(game.name.toUpperCase(), centreX, 590)

  ctx.fillStyle = '#f5c84c'
  ctx.font = '700 150px "Clash Royale", system-ui, sans-serif'
  ctx.fillText(input.score, centreX, 730)

  if (input.playerName) {
    roundedRect(ctx, 150, 766, 780, 112, 30)
    ctx.fillStyle = 'rgba(7, 6, 16, 0.72)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(245, 200, 76, 0.72)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = '#d7c8ff'
    ctx.font = '700 24px Inter, system-ui, sans-serif'
    ctx.fillText('PLAYED BY', centreX, 803)
    ctx.fillStyle = '#f5c84c'
    ctx.font = playerNameFont(ctx, input.playerName)
    ctx.fillText(input.playerName, centreX, 854)
  }

  // Cost-band squares: one per band, filled in proportion to accuracy. The
  // same information the summary's bar chart carries, at a size that survives
  // being looked at on a phone in a group chat.
  const bands = (input.bands ?? []).filter((band) => band.total > 0)
  if (bands.length) {
    const box = 96
    const gap = 18
    const totalWidth = bands.length * box + (bands.length - 1) * gap
    let x = centreX - totalWidth / 2
    const y = 914
    for (const band of bands) {
      const ratio = band.correct / band.total
      ctx.fillStyle = 'rgba(215, 200, 255, 0.16)'
      roundedRect(ctx, x, y, box, box, 18)
      ctx.fill()
      ctx.fillStyle = ratio >= 0.99 ? '#22c55e' : '#8b5cf6'
      const fill = Math.round(box * ratio)
      roundedRect(ctx, x, y + (box - fill), box, fill, 18)
      ctx.fill()
      ctx.fillStyle = '#f7f4ff'
      ctx.font = '700 34px Inter, system-ui, sans-serif'
      ctx.fillText(band.label, x + box / 2, y + box + 44)
      x += box + gap
    }
  }

  if (arena) {
    const size = 132
    ctx.save()
    ctx.beginPath()
    ctx.arc(centreX, 1120, size / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(arena, centreX - size / 2, 1120 - size / 2, size, size)
    ctx.restore()
  }
  if (input.arenaName) {
    ctx.fillStyle = '#c8c1e6'
    ctx.font = '600 34px Inter, system-ui, sans-serif'
    ctx.fillText(input.arenaName, centreX, 1226)
  }
  if (input.rank !== undefined) {
    ctx.fillStyle = '#f5c84c'
    ctx.font = '700 44px "Clash Royale", system-ui, sans-serif'
    ctx.fillText(`#${input.rank}`, centreX, 1278)
  }

  if (sticker) {
    const size = Math.round(SHARE_WIDTH * STICKER_RATIO)
    const margin = 44
    ctx.drawImage(sticker, SHARE_WIDTH - size - margin, SHARE_HEIGHT - size - margin, size, size)
  }

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}

// Whether this browser can share a generated file at all. Checked BEFORE
// spending time rendering: on a desktop browser with no file sharing, the card
// would be built and then thrown away.
export function canShareImage(): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  try {
    const probe = new File([new Blob([], { type: 'image/png' })], 'probe.png', { type: 'image/png' })
    return navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}
