import type { BadgeTier } from '@elixir-drop/contracts'
import type { PublishedBadgePreview, PublishedProfilePreview, PublishedRunPreview } from './api-contracts'
import { gameDisplay } from './game-metadata'
import { rankFor } from '../data/starRanks'

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

export const SHARE_WIDTH = 1200
export const SHARE_HEIGHT = 630
export const RUN_SHARE_WIDTH = SHARE_WIDTH
export const RUN_SHARE_HEIGHT = SHARE_HEIGHT

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

function drawShareFrame(ctx: CanvasRenderingContext2D, backdrop: HTMLImageElement): void {
  drawCover(ctx, backdrop, 0, 0, SHARE_WIDTH, SHARE_HEIGHT)
  roundedRect(ctx, 30, 28, 1140, 574, 34)
  ctx.fillStyle = 'rgba(7, 6, 22, 0.78)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(245, 200, 76, 0.42)'
  ctx.lineWidth = 3
  ctx.stroke()
}

function drawPlayerHeader(
  ctx: CanvasRenderingContext2D,
  playerName: string,
  label: string,
  avatar: HTMLImageElement | null
): void {
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
  ctx.font = fittedDisplayFont(ctx, playerName, 650, 46, 30)
  ctx.fillText(playerName, 178, 110)
  ctx.fillStyle = '#c8c1e6'
  ctx.font = '600 24px Inter, system-ui, sans-serif'
  ctx.fillText(label, 180, 140)
}

function drawShareFooter(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#f5c84c'
  ctx.textAlign = 'left'
  ctx.font = '700 27px "Clash Royale", system-ui, sans-serif'
  ctx.fillText('ELIXIR DROP', 76, 577)
  ctx.fillStyle = '#c8c1e6'
  ctx.textAlign = 'right'
  ctx.font = '600 22px Inter, system-ui, sans-serif'
  ctx.fillText('drop.poapkings.com', 1124, 577)
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

  drawShareFrame(ctx, backdrop)
  drawPlayerHeader(ctx, input.playerName, 'SHARED A RUN', avatar)

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

  drawShareFooter(ctx)

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

function badgeRim(
  ctx: CanvasRenderingContext2D,
  tier: BadgeTier,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): CanvasGradient {
  const gradient = ctx.createLinearGradient(x1, y1, x2, y2)
  const colors: Record<BadgeTier, [string, string]> = {
    unlit: ['#37324f', '#1d1930'],
    copper: ['#d08a52', '#7a4520'],
    silver: ['#dfe4f2', '#8a92ad'],
    gold: ['#ffe189', '#b77513'],
    prismatic: ['#f5c84c', '#8b5cf6']
  }
  gradient.addColorStop(0, colors[tier][0])
  if (tier === 'prismatic') {
    gradient.addColorStop(0.35, '#8b5cf6')
    gradient.addColorStop(0.68, '#3b82f6')
  }
  gradient.addColorStop(1, colors[tier][1])
  return gradient
}

function drawBadgeMedallion(ctx: CanvasRenderingContext2D, art: HTMLImageElement, tier: BadgeTier): void {
  const centreX = 258
  const centreY = 348
  ctx.save()
  ctx.translate(centreX, centreY)
  ctx.strokeStyle = 'rgba(245, 200, 76, 0.24)'
  ctx.lineWidth = 8
  ctx.lineCap = 'round'
  for (let index = 0; index < 16; index += 1) {
    ctx.rotate(Math.PI / 8)
    ctx.beginPath()
    ctx.moveTo(172, 0)
    ctx.lineTo(index % 2 === 0 ? 194 : 184, 0)
    ctx.stroke()
  }
  ctx.restore()
  ctx.save()
  ctx.shadowColor = 'rgba(139, 92, 246, 0.54)'
  ctx.shadowBlur = 48
  ctx.beginPath()
  ctx.arc(centreX, centreY, 166, 0, Math.PI * 2)
  ctx.fillStyle = badgeRim(ctx, tier, 92, 182, 424, 514)
  ctx.fill()
  ctx.restore()
  const plate = ctx.createRadialGradient(210, 282, 20, centreX, centreY, 149)
  plate.addColorStop(0, '#402f74')
  plate.addColorStop(1, '#0c091e')
  ctx.beginPath()
  ctx.arc(centreX, centreY, 149, 0, Math.PI * 2)
  ctx.fillStyle = plate
  ctx.fill()
  ctx.drawImage(art, centreX - 132, centreY - 132, 264, 264)
}

function drawProfileBadgeMedallion(
  ctx: CanvasRenderingContext2D,
  art: HTMLImageElement,
  tier: BadgeTier,
  centreX: number,
  centreY: number
): void {
  const radius = 84
  ctx.save()
  ctx.shadowColor = 'rgba(139, 92, 246, 0.5)'
  ctx.shadowBlur = 34
  ctx.beginPath()
  ctx.arc(centreX, centreY, radius, 0, Math.PI * 2)
  ctx.fillStyle = badgeRim(ctx, tier, centreX - radius, centreY - radius, centreX + radius, centreY + radius)
  ctx.fill()
  ctx.restore()
  const plate = ctx.createRadialGradient(centreX - 18, centreY - 24, 8, centreX, centreY, radius - 8)
  plate.addColorStop(0, '#402f74')
  plate.addColorStop(1, '#0c091e')
  ctx.beginPath()
  ctx.arc(centreX, centreY, radius - 9, 0, Math.PI * 2)
  ctx.fillStyle = plate
  ctx.fill()
  ctx.drawImage(art, centreX - 67, centreY - 67, 134, 134)
}

export async function renderProfileSharePreview(input: PublishedProfilePreview): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_WIDTH
  canvas.height = SHARE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const [backdrop, avatar, badgeArt] = await Promise.all([
    loadImage('/assets/share/share-backdrop.png'),
    input.favoriteCardId ? loadImage(`/cards/${input.favoriteCardId}.png`) : Promise.resolve(null),
    Promise.all(input.badges.map((badge) => loadImage(`/assets/badges/${badge.slug}-384.png`)))
  ])
  const fontsReady = await readyFonts()
  if (!backdrop || !fontsReady || badgeArt.some((art) => !art)) return null

  drawShareFrame(ctx, backdrop)

  const avatarX = 76
  const avatarY = 86
  const avatarSize = 176
  ctx.save()
  ctx.beginPath()
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
  ctx.clip()
  if (avatar) drawCover(ctx, avatar, avatarX, avatarY, avatarSize, avatarSize)
  else {
    const plate = ctx.createRadialGradient(164, 126, 12, 164, 174, 88)
    plate.addColorStop(0, '#f5c84c')
    plate.addColorStop(1, '#6d28d9')
    ctx.fillStyle = plate
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize)
  }
  ctx.restore()
  ctx.beginPath()
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
  ctx.strokeStyle = '#f5c84c'
  ctx.lineWidth = 6
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.fillStyle = '#c8c1e6'
  ctx.font = '800 22px Inter, system-ui, sans-serif'
  ctx.fillText('PLAYER PROFILE', 292, 112)
  ctx.fillStyle = '#f7f4ff'
  // The identity column ends before the first medallion. Fit long community
  // names and arena names inside it instead of letting text disappear behind
  // the badge highlight row.
  ctx.font = fittedDisplayFont(ctx, input.playerName, 308, 54, 28)
  ctx.fillText(input.playerName, 288, 181)
  const arena = rankFor(input.xp).current.name.toUpperCase()
  ctx.fillStyle = '#f5c84c'
  ctx.font = fittedDisplayFont(ctx, arena, 306, 38, 22)
  ctx.fillText(arena, 290, 233)

  roundedRect(ctx, 76, 306, 520, 164, 22)
  ctx.fillStyle = 'rgba(11, 8, 31, 0.72)'
  ctx.fill()
  ctx.fillStyle = '#f5c84c'
  ctx.font = fittedDisplayFont(ctx, input.xp.toLocaleString(), 310, 58, 40)
  ctx.fillText(input.xp.toLocaleString(), 106, 380)
  ctx.fillStyle = '#c8c1e6'
  ctx.font = '800 21px Inter, system-ui, sans-serif'
  ctx.fillText('PLAYER XP', 108, 415)
  ctx.fillStyle = '#f7f4ff'
  ctx.font = fittedDisplayFont(ctx, String(input.badgeCount), 130, 58, 40)
  ctx.fillText(String(input.badgeCount), 414, 380)
  ctx.fillStyle = '#c8c1e6'
  ctx.font = '800 21px Inter, system-ui, sans-serif'
  ctx.fillText(input.badgeCount === 1 ? 'BADGE' : 'BADGES', 416, 415)

  ctx.fillStyle = '#d7c8ff'
  ctx.font = '700 26px "Clash Royale", system-ui, sans-serif'
  ctx.fillText(input.badges.length ? 'BADGE HIGHLIGHTS' : 'BADGE WALL', 654, 112)
  if (input.badges.length) {
    const centres = input.badges.length === 1 ? [890] : input.badges.length === 2 ? [785, 1010] : [704, 904, 1090]
    input.badges.forEach((badge, index) => {
      const centre = centres[index] ?? 904
      drawProfileBadgeMedallion(ctx, badgeArt[index]!, badge.tier, centre, 282)
      ctx.textAlign = 'center'
      ctx.fillStyle = '#f7f4ff'
      ctx.font = fittedDisplayFont(ctx, badge.name.toUpperCase(), 170, 22, 16)
      ctx.fillText(badge.name.toUpperCase(), centre, 390)
      ctx.fillStyle = '#65e18b'
      ctx.font = '800 19px Inter, system-ui, sans-serif'
      ctx.fillText(badge.chip, centre, 421)
    })
  } else {
    roundedRect(ctx, 654, 150, 470, 320, 22)
    ctx.fillStyle = 'rgba(11, 8, 31, 0.72)'
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.fillStyle = '#f5c84c'
    ctx.font = '700 35px "Clash Royale", system-ui, sans-serif'
    ctx.fillText('THE WALL STARTS HERE', 889, 300)
    ctx.fillStyle = '#c8c1e6'
    ctx.font = '700 23px Inter, system-ui, sans-serif'
    ctx.fillText('Play a recorded run to earn the first badge.', 889, 350)
  }

  drawShareFooter(ctx)
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}

export async function renderBadgeSharePreview(input: PublishedBadgePreview): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_WIDTH
  canvas.height = SHARE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const [backdrop, art, avatar] = await Promise.all([
    loadImage('/assets/share/share-backdrop.png'),
    loadImage(`/assets/badges/${input.slug}-384.png`),
    input.favoriteCardId ? loadImage(`/cards/${input.favoriteCardId}.png`) : Promise.resolve(null)
  ])
  const fontsReady = await readyFonts()
  if (!backdrop || !art || !fontsReady) return null

  drawShareFrame(ctx, backdrop)
  drawPlayerHeader(ctx, input.playerName, 'EARNED A BADGE', avatar)
  drawBadgeMedallion(ctx, art, input.tier)

  ctx.fillStyle = '#f5c84c'
  ctx.textAlign = 'left'
  ctx.font = fittedDisplayFont(ctx, input.name.toUpperCase(), 650, 88, 48)
  ctx.fillText(input.name.toUpperCase(), 470, 266)

  const rungNumber = input.rungIndex + 1
  ctx.fillStyle = '#d7c8ff'
  ctx.font = '700 31px "Clash Royale", system-ui, sans-serif'
  ctx.fillText(
    input.hidden ? `${input.tier.toUpperCase()} · SECRET BADGE` : `${input.tier.toUpperCase()} BADGE`,
    474,
    320
  )
  ctx.fillStyle = '#65e18b'
  ctx.font = '700 30px Inter, system-ui, sans-serif'
  ctx.fillText(input.hidden ? 'Secret discovered' : `${input.chip} milestone earned`, 474, 366)

  const detailX = 470
  const detailY = 402
  const detailWidth = 654
  const detailHeight = 116
  roundedRect(ctx, detailX, detailY, detailWidth, detailHeight, 18)
  ctx.fillStyle = 'rgba(11, 8, 31, 0.72)'
  ctx.fill()
  ctx.fillStyle = '#b9add6'
  ctx.font = '600 18px Inter, system-ui, sans-serif'
  ctx.fillText('BADGE CHALLENGE', detailX + 26, detailY + 34)
  const requirement = (input.requirement ?? 'Secret badge discovered').toUpperCase()
  ctx.fillStyle = '#f7f4ff'
  ctx.font = fittedDisplayFont(ctx, requirement, detailWidth - 52, 29, 20)
  ctx.fillText(requirement, detailX + 26, detailY + 76)
  ctx.textAlign = 'right'
  ctx.font = '600 18px Inter, system-ui, sans-serif'
  ctx.fillStyle = '#b9add6'
  ctx.fillText(
    input.rungCount === 1 ? 'MILESTONE CLEARED' : `MILESTONE ${rungNumber} OF ${input.rungCount}`,
    detailX + detailWidth - 26,
    detailY + 34
  )

  drawShareFooter(ctx)

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
}
