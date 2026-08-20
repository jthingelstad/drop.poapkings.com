import type { Container, Sprite, Texture, Ticker } from 'pixi.js'
import { allCards } from '../lib/card-catalog'
import { loadPixi } from '../lib/load-pixi'

// "Elixir Rain": card art drifts down through floating elixir droplets in
// three parallax layers, occasionally flipping into another card. Pure Pixi,
// pooled sprites, and one bounded texture cast; the ticker pauses while the tab
// is hidden. Card art is same-origin (mirrored), so textures load clean.

const PALETTE = [0x8b5cf6, 0xa855f7, 0xc084fc, 0xf5c84c]
// The scene draws from the whole catalog over time, but only this many textures
// are resident at once. A watcher trades a small batch every interval.
const INITIAL_CAST_SIZE = 30
const CAST_ROTATION_SIZE = 6
const CAST_ROTATION_MS = 20_000
const FLIP_DURATION_MS = 620

export const fallingCardsFrameRate = (foreground: boolean): number => (foreground ? 60 : 20)

export interface ElixirRainScene {
  destroy(): void
  setEnabled(enabled: boolean): void
  setForeground(foreground: boolean): void
}

interface RainCard {
  sprite: Sprite
  layerScale: number
  fallSpeed: number
  swayAmp: number
  swayFreq: number
  swayPhase: number
  spin: number
  baseX: number
  flipInMs: number
  flipPhase: number
}

interface Droplet {
  sprite: import('pixi.js').Graphics
  drift: number
  rise: number
  pulseFreq: number
  pulsePhase: number
}

function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swap]] = [result[swap]!, result[index]!]
  }
  return result
}

export function rotateCastWindow<T>(
  catalog: readonly T[],
  active: readonly T[],
  cursor: number,
  batchSize = CAST_ROTATION_SIZE
): { active: T[]; incoming: T[]; retired: T[]; nextCursor: number } {
  if (catalog.length <= active.length || batchSize <= 0) {
    return { active: [...active], incoming: [], retired: [], nextCursor: cursor }
  }

  const incoming: T[] = []
  let nextCursor = cursor
  let inspected = 0
  while (incoming.length < Math.min(batchSize, active.length) && inspected < catalog.length) {
    const candidate = catalog[nextCursor % catalog.length]!
    nextCursor = (nextCursor + 1) % catalog.length
    inspected += 1
    if (!active.includes(candidate) && !incoming.includes(candidate)) incoming.push(candidate)
  }

  const retired = active.slice(0, incoming.length)
  return {
    active: [...active.slice(incoming.length), ...incoming],
    incoming,
    retired,
    nextCursor
  }
}

const between = (low: number, high: number) => low + Math.random() * (high - low)

export async function createElixirRain(
  host: HTMLDivElement,
  options: { paused?: boolean; foreground?: boolean; enabled?: boolean } = {}
): Promise<ElixirRainScene> {
  const { Application, Assets, Container: PixiContainer, Graphics, Sprite: PixiSprite } = await loadPixi()

  const app = new Application()
  await app.init({
    resizeTo: host,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2)
  })
  app.ticker.maxFPS = fallingCardsFrameRate(options.foreground ?? true)
  app.canvas.className = 'elixir-rain__canvas'
  app.canvas.setAttribute('aria-hidden', 'true')
  app.canvas.hidden = options.enabled === false
  host.appendChild(app.canvas)

  // A freshly shuffled run through the whole catalog every activation.
  let destroyed = false
  const catalog = shuffled(allCards.filter((card) => card.icon))
  const allUrls = catalog.map((card) => card.icon)
  let activeUrls = allUrls.slice(0, INITIAL_CAST_SIZE)
  const loaded = await Assets.load<Texture>(activeUrls)
  let textureEntries = activeUrls
    .map((url) => ({ url, texture: loaded[url] }))
    .filter((entry): entry is { url: string; texture: Texture } => Boolean(entry.texture))
  if (!textureEntries.length) throw new Error('No card textures available for the screensaver')
  activeUrls = textureEntries.map((entry) => entry.url)
  let castCursor = INITIAL_CAST_SIZE % allUrls.length
  let rotatingCast = false
  let enabled = options.enabled ?? true

  const small = app.screen.width < 600
  const randomTexture = () => textureEntries[Math.floor(Math.random() * textureEntries.length)]!.texture

  // Droplets sit behind every card layer.
  const dropletLayer: Container = new PixiContainer()
  app.stage.addChild(dropletLayer)
  const droplets: Droplet[] = []
  const dropletCount = small ? 20 : 40
  for (let index = 0; index < dropletCount; index += 1) {
    const radius = between(2, 7)
    const sprite = new Graphics().circle(0, 0, radius).fill({ color: PALETTE[index % PALETTE.length]!, alpha: 0.5 })
    sprite.position.set(Math.random() * app.screen.width, Math.random() * app.screen.height)
    dropletLayer.addChild(sprite)
    droplets.push({
      sprite,
      drift: between(-6, 6),
      rise: between(4, 14),
      pulseFreq: between(0.2, 0.7),
      pulsePhase: Math.random() * Math.PI * 2
    })
  }

  const layers = [
    { scale: 0.34, alpha: 0.45, speed: 0.55, count: small ? 5 : 10 },
    { scale: 0.55, alpha: 0.75, speed: 0.8, count: small ? 5 : 10 },
    { scale: 0.85, alpha: 1, speed: 1.15, count: small ? 6 : 10 }
  ]
  const cards: RainCard[] = []
  for (const layer of layers) {
    const container: Container = new PixiContainer()
    container.alpha = layer.alpha
    app.stage.addChild(container)
    for (let index = 0; index < layer.count; index += 1) {
      const sprite = new PixiSprite(randomTexture())
      sprite.anchor.set(0.5)
      sprite.scale.set(layer.scale)
      const baseX = Math.random() * app.screen.width
      sprite.position.set(baseX, Math.random() * app.screen.height)
      container.addChild(sprite)
      cards.push({
        sprite,
        layerScale: layer.scale,
        fallSpeed: between(26, 64) * layer.speed,
        swayAmp: between(8, 34),
        swayFreq: between(0.15, 0.45),
        swayPhase: Math.random() * Math.PI * 2,
        spin: between(-0.1, 0.1),
        baseX,
        flipInMs: between(6_000, 20_000),
        flipPhase: -1
      })
    }
  }

  // Keep only one 30-card cast resident. A small timer-driven exchange brings
  // new faces in, moves any sprites off retiring textures, then unloads those
  // textures. Over time the whole catalog visits the scene without the whole
  // catalog living in GPU memory at once.
  const rotateCast = async () => {
    if (destroyed || rotatingCast || !enabled || document.hidden || options.paused) return
    const plan = rotateCastWindow(allUrls, activeUrls, castCursor)
    if (!plan.incoming.length) return
    rotatingCast = true
    try {
      const incoming = await Assets.load<Texture>(plan.incoming)
      if (destroyed) {
        await Assets.unload(plan.incoming).catch(() => undefined)
        return
      }
      const incomingEntries = plan.incoming
        .map((url) => ({ url, texture: incoming[url] }))
        .filter((entry): entry is { url: string; texture: Texture } => Boolean(entry.texture))
      if (!incomingEntries.length) return

      const retiredEntries = textureEntries.slice(0, incomingEntries.length)
      const retiredTextures = new Set(retiredEntries.map((entry) => entry.texture))
      textureEntries = [...textureEntries.slice(incomingEntries.length), ...incomingEntries]
      activeUrls = textureEntries.map((entry) => entry.url)
      castCursor = plan.nextCursor

      for (const card of cards) {
        if (retiredTextures.has(card.sprite.texture)) card.sprite.texture = randomTexture()
      }
      // Pixi can retain a texture in the render instructions it already built
      // for the current frame. Give it a safe gap before freeing the retired
      // GPU resources; keeping this await inside the task also serializes swaps.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000))
      await Assets.unload(retiredEntries.map((entry) => entry.url)).catch(() => undefined)
    } finally {
      rotatingCast = false
    }
  }
  const castRotationTimer = window.setInterval(() => void rotateCast(), CAST_ROTATION_MS)

  // The Elixir mascot cameo glided across here every ~45s until the emote set
  // was retired. The scene rotates the whole card catalog, which is what the
  // screensaver is actually for.

  let elapsedS = 0
  const update = (ticker: Ticker) => {
    const deltaS = ticker.deltaMS / 1000
    elapsedS += deltaS
    const { width, height } = app.screen

    for (const droplet of droplets) {
      droplet.sprite.y -= droplet.rise * deltaS
      droplet.sprite.x += droplet.drift * deltaS
      droplet.sprite.alpha = 0.3 + 0.3 * Math.sin(elapsedS * droplet.pulseFreq * Math.PI * 2 + droplet.pulsePhase)
      if (droplet.sprite.y < -12) {
        droplet.sprite.y = height + 12
        droplet.sprite.x = Math.random() * width
      }
    }

    for (const card of cards) {
      card.sprite.y += card.fallSpeed * deltaS
      card.sprite.x = card.baseX + Math.sin(elapsedS * card.swayFreq * Math.PI * 2 + card.swayPhase) * card.swayAmp
      card.sprite.rotation += card.spin * deltaS

      if (card.flipPhase >= 0) {
        card.flipPhase += ticker.deltaMS
        const progress = Math.min(1, card.flipPhase / FLIP_DURATION_MS)
        // scale.x sweeps through zero; swap the face at the crossing.
        const flip = Math.abs(Math.cos(progress * Math.PI))
        card.sprite.scale.x = card.layerScale * Math.max(0.02, flip)
        if (progress >= 0.5 && card.flipPhase - ticker.deltaMS < FLIP_DURATION_MS / 2) {
          card.sprite.texture = randomTexture()
        }
        if (progress >= 1) {
          card.sprite.scale.x = card.layerScale
          card.flipPhase = -1
          card.flipInMs = between(8_000, 24_000)
        }
      } else {
        card.flipInMs -= ticker.deltaMS
        if (card.flipInMs <= 0) card.flipPhase = 0
      }

      const margin = card.sprite.height / 2 + 20
      if (card.sprite.y > height + margin) {
        card.sprite.y = -margin
        card.baseX = Math.random() * width
        card.sprite.texture = randomTexture()
      }
    }
  }
  app.ticker.add(update)
  if (options.paused || !enabled) app.ticker.stop()

  const onVisibility = () => {
    if (document.hidden || options.paused || !enabled) app.ticker.stop()
    else app.ticker.start()
  }
  document.addEventListener('visibilitychange', onVisibility)

  return {
    setEnabled(nextEnabled) {
      enabled = nextEnabled
      app.canvas.hidden = !nextEnabled
      if (!nextEnabled || document.hidden || options.paused) app.ticker.stop()
      else app.ticker.start()
    },
    setForeground(foreground) {
      app.ticker.maxFPS = fallingCardsFrameRate(foreground)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      window.clearInterval(castRotationTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      app.ticker.stop()
      app.ticker.remove(update)
      const urlsToUnload = [...activeUrls]
      window.setTimeout(() => {
        const ticker = app.ticker
        ticker.destroy()
        app.stage.destroy({ children: true })
        app.renderer.destroy({ removeView: true })
        void Assets.unload(urlsToUnload).catch(() => undefined)
      }, 250)
    }
  }
}
