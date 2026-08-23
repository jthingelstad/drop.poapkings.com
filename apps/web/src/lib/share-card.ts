import type { BadgeTier } from '@elixir-drop/contracts'
import type { PublishedRunPreview } from './api-contracts'
import { gameDisplay } from './game-metadata'

// Badge and recorded-run previews use one browser canvas pipeline, the same
// same-origin PNG art, and the real Clash face. Run previews are uploaded to
// the permanent link before the browser opens its URL-only native share sheet.
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
export const RUN_SHARE_WIDTH = 1200
export const RUN_SHARE_HEIGHT = 630

// Bottom-right, ~15% of the card's width (46px on a 300px-wide preview).
const STICKER_RATIO = 0.15

export interface BadgeShareCardInput {
  slug: string
  name: string
  chip: string
  tier: BadgeTier
  requirement?: string
  playerName: string
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
async function readyFonts(): Promise<boolean> {
  if (!('fonts' in document)) return false
  try {
    await Promise.all([
      document.fonts.load('700 150px "Clash Royale"'),
      document.fonts.load('700 96px "Clash Royale"'),
      document.fonts.load('700 44px "Clash Royale"')
    ])
    return document.fonts.check('700 96px "Clash Royale"')
  } catch {
    return false
  }
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const sourceWidth = width / scale
  const sourceHeight = height / scale
  const sourceX = (image.naturalWidth - sourceWidth) / 2
  const sourceY = (image.naturalHeight - sourceHeight) / 2
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height)
}

function fittedDisplayFont(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  start: number,
  minimum: number
): string {
  for (let size = start; size >= minimum; size -= 2) {
    const font = `700 ${size}px "Clash Royale", system-ui, sans-serif`
    ctx.font = font
    if (ctx.measureText(value).width <= maxWidth) return font
  }
  return `700 ${minimum}px "Clash Royale", system-ui, sans-serif`
}

function modeContext(mode: PublishedRunPreview['mode'], count: number): string {
  const noun = {
    surge: 'CARDS',
    trade: 'EXCHANGES',
    survival: 'CARDS',
    rain: 'DROPS',
    'higher-lower': 'READS',
    practice: 'READS'
  }[mode]
  return `${gameDisplay(mode).name.toUpperCase()} · ${count} ${noun}`
}

function comparisonLine(input: PublishedRunPreview): string | undefined {
  const visual = input.visual
  if (input.mode !== 'surge' || !visual?.values.length || !visual.refs || visual.refs.length !== visual.values.length)
    return undefined
  const current = visual.values.reduce((sum, value) => sum + value, 0)
  const previous = visual.refs.reduce((sum, value) => sum + value, 0)
  const difference = previous - current
  if (difference <= 0) return undefined
  return `${(difference / 1000).toFixed(3)}s faster than my best`
}

export async function renderRunSharePreview(input: PublishedRunPreview): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = RUN_SHARE_WIDTH
  canvas.height = RUN_SHARE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const [backdrop, modeArt, avatar] = await Promise.all([
    loadImage('/assets/share/share-backdrop.png'),
    loadImage(`/assets/modes/${input.mode}-384.png`),
    input.favoriteCardId ? loadImage(`/cards/${input.favoriteCardId}.png`) : Promise.resolve(null)
  ])
  const fontsReady = await readyFonts()
  if (!backdrop || !modeArt || !fontsReady) return null

  drawCover(ctx, backdrop, 0, 0, RUN_SHARE_WIDTH, RUN_SHARE_HEIGHT)
  roundedRect(ctx, 30, 28, 1140, 574, 34)
  ctx.fillStyle = 'rgba(7, 6, 22, 0.78)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(245, 200, 76, 0.42)'
  ctx.lineWidth = 3
  ctx.stroke()

  const avatarX = 78
  const avatarY = 60
  const avatarSize = 78
  ctx.save()
  ctx.beginPath()
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
  ctx.clip()
  if (avatar) drawCover(ctx, avatar, avatarX, avatarY, avatarSize, avatarSize)
  else {
    const plate = ctx.createRadialGradient(117, 83, 6, 117, 99, 40)
    plate.addColorStop(0, '#f5c84c')
    plate.addColorStop(1, '#6d28d9')
    ctx.fillStyle = plate
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize)
  }
  ctx.restore()
  ctx.beginPath()
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
  ctx.strokeStyle = '#f5c84c'
  ctx.lineWidth = 4
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.fillStyle = '#f7f4ff'
  ctx.font = fittedDisplayFont(ctx, input.playerName, 650, 46, 30)
  ctx.fillText(input.playerName, 178, 110)
  ctx.fillStyle = '#c8c1e6'
  ctx.font = '600 24px Inter, system-ui, sans-serif'
  ctx.fillText('SHARED A RUN', 180, 140)

  ctx.save()
  ctx.shadowColor = 'rgba(139, 92, 246, 0.44)'
  ctx.shadowBlur = 34
  ctx.drawImage(modeArt, 1002, 48, 122, 122)
  ctx.restore()

  ctx.fillStyle = '#f5c84c'
  ctx.font = fittedDisplayFont(ctx, input.score.toUpperCase(), 620, 116, 70)
  ctx.fillText(input.score.toUpperCase(), 76, 284)

  const values = input.visual?.values ?? []
  ctx.fillStyle = '#d7c8ff'
  ctx.font = '700 31px "Clash Royale", system-ui, sans-serif'
  ctx.fillText(modeContext(input.mode, values.length), 760, 240)
  const comparison = comparisonLine(input)
  if (comparison) {
    ctx.fillStyle = '#65e18b'
    ctx.font = '700 26px Inter, system-ui, sans-serif'
    ctx.fillText(comparison, 760, 282)
  }

  const chartX = 76
  const chartY = 340
  const chartWidth = 1048
  const chartHeight = 150
  roundedRect(ctx, chartX, chartY, chartWidth, chartHeight, 18)
  ctx.fillStyle = 'rgba(11, 8, 31, 0.72)'
  ctx.fill()
  if (values.length) {
    const refs = input.visual?.refs ?? []
    const peak = Math.max(1, ...values, ...refs)
    const gap = values.length > 22 ? 5 : 8
    const slot = chartWidth / values.length
    const barWidth = Math.max(3, slot - gap)
    const baseY = chartY + chartHeight - 12
    values.forEach((value, index) => {
      const height = Math.max(6, (value / peak) * (chartHeight - 28))
      const x = chartX + index * slot + gap / 2
      roundedRect(ctx, x, baseY - height, barWidth, height, Math.min(6, barWidth / 2))
      ctx.fillStyle = input.visual?.bad?.[index] ? '#f15b69' : '#ad70ff'
      ctx.fill()
      const reference = refs[index]
      if (reference !== undefined) {
        const y = baseY - (reference / peak) * (chartHeight - 28)
        ctx.fillStyle = '#ffde74'
        ctx.fillRect(x - 1, y - 2, barWidth + 2, 4)
      }
    })
  } else {
    ctx.fillStyle = '#c8c1e6'
    ctx.font = '600 26px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('A RUN WORTH SHARING', RUN_SHARE_WIDTH / 2, chartY + 88)
  }

  ctx.textAlign = 'left'
  ctx.fillStyle = '#b9add6'
  ctx.font = '600 20px Inter, system-ui, sans-serif'
  ctx.fillText(input.visual?.unit ?? 'RUN RESULTS', chartX, 528)
  const costly = input.visual?.bad?.filter(Boolean).length ?? 0
  if (costly) {
    ctx.textAlign = 'right'
    ctx.fillStyle = '#f68a94'
    ctx.fillText(`${costly} ${costly === 1 ? 'COSTLY RESULT' : 'COSTLY RESULTS'}`, chartX + chartWidth, 528)
  }

  ctx.fillStyle = '#f5c84c'
  ctx.textAlign = 'left'
  ctx.font = '700 27px "Clash Royale", system-ui, sans-serif'
  ctx.fillText('ELIXIR DROP', 76, 577)
  ctx.fillStyle = '#c8c1e6'
  ctx.textAlign = 'right'
  ctx.font = '600 22px Inter, system-ui, sans-serif'
  ctx.fillText('drop.poapkings.com', 1124, 577)

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
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

function badgeRim(ctx: CanvasRenderingContext2D, tier: BadgeTier): CanvasGradient {
  if (tier === 'prismatic' && 'createConicGradient' in ctx) {
    const gradient = ctx.createConicGradient(Math.PI * 1.15, SHARE_WIDTH / 2, 490)
    gradient.addColorStop(0, '#f5c84c')
    gradient.addColorStop(0.25, '#8b5cf6')
    gradient.addColorStop(0.5, '#3b82f6')
    gradient.addColorStop(0.75, '#22c55e')
    gradient.addColorStop(1, '#f5c84c')
    return gradient
  }
  const gradient = ctx.createLinearGradient(365, 320, 715, 660)
  const colors: Record<BadgeTier, [string, string]> = {
    unlit: ['#37324f', '#1d1930'],
    copper: ['#d08a52', '#7a4520'],
    silver: ['#dfe4f2', '#8a92ad'],
    gold: ['#ffe189', '#b77513'],
    prismatic: ['#f5c84c', '#8b5cf6']
  }
  gradient.addColorStop(0, colors[tier][0])
  gradient.addColorStop(1, colors[tier][1])
  return gradient
}

function badgeChip(ctx: CanvasRenderingContext2D, chip: string, tier: BadgeTier, y: number): void {
  ctx.font = '700 42px "Clash Royale", system-ui, sans-serif'
  const width = Math.max(126, ctx.measureText(chip).width + 58)
  roundedRect(ctx, SHARE_WIDTH / 2 - width / 2, y, width, 68, 34)
  ctx.fillStyle = badgeRim(ctx, tier)
  ctx.fill()
  ctx.fillStyle = '#211100'
  ctx.fillText(chip, SHARE_WIDTH / 2, y + 49)
}

export async function renderBadgeShareCard(input: BadgeShareCardInput): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_WIDTH
  canvas.height = SHARE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const [backdrop, sticker, art] = await Promise.all([
    loadImage('/assets/share/share-backdrop.png'),
    loadImage('/assets/share/share-sticker.png'),
    loadImage(`/assets/badges/${input.slug}-384.png`)
  ])
  const fontsReady = await readyFonts()
  if (!backdrop || !art || !fontsReady) return null

  ctx.drawImage(backdrop, 0, 0, SHARE_WIDTH, SHARE_HEIGHT)
  const centreX = SHARE_WIDTH / 2
  ctx.textAlign = 'center'

  ctx.fillStyle = '#d7c8ff'
  ctx.font = '700 44px "Clash Royale", system-ui, sans-serif'
  ctx.fillText('EARNED BADGE', centreX, 206)

  ctx.save()
  ctx.shadowColor = 'rgba(139, 92, 246, 0.56)'
  ctx.shadowBlur = 54
  ctx.beginPath()
  ctx.arc(centreX, 490, 188, 0, Math.PI * 2)
  ctx.fillStyle = badgeRim(ctx, input.tier)
  ctx.fill()
  ctx.restore()

  const plate = ctx.createRadialGradient(centreX, 430, 24, centreX, 490, 164)
  plate.addColorStop(0, '#402f74')
  plate.addColorStop(1, '#0c091e')
  ctx.beginPath()
  ctx.arc(centreX, 490, 162, 0, Math.PI * 2)
  ctx.fillStyle = plate
  ctx.fill()
  ctx.drawImage(art, centreX - 130, 360, 260, 260)
  if (input.chip) badgeChip(ctx, input.chip, input.tier, 624)

  ctx.fillStyle = '#f5c84c'
  ctx.font = '700 82px "Clash Royale", system-ui, sans-serif'
  ctx.fillText(input.name, centreX, 820)

  if (input.requirement) {
    ctx.fillStyle = '#c8c1e6'
    ctx.font = '600 34px Inter, system-ui, sans-serif'
    ctx.fillText(input.requirement, centreX, 880)
  }

  roundedRect(ctx, 150, 930, 780, 142, 30)
  ctx.fillStyle = 'rgba(7, 6, 16, 0.72)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(245, 200, 76, 0.72)'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = '#d7c8ff'
  ctx.font = '700 24px Inter, system-ui, sans-serif'
  ctx.fillText('EARNED BY', centreX, 974)
  ctx.fillStyle = '#f5c84c'
  ctx.font = playerNameFont(ctx, input.playerName)
  ctx.fillText(input.playerName, centreX, 1045)

  ctx.fillStyle = '#c8c1e6'
  ctx.font = '600 30px Inter, system-ui, sans-serif'
  ctx.fillText('drop.poapkings.com', centreX, 1190)

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
