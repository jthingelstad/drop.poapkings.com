import type { Container, Sprite, Texture, Ticker } from 'pixi.js'
import rawCards from '@elixir-drop/game-data/cards.json'
import type { CardsData } from '../types'
import { loadPixi } from '../lib/load-pixi'

// "Elixir Rain": card art drifts down through floating elixir droplets in
// three parallax layers, occasionally flipping into another card. Pure Pixi,
// pooled sprites, zero steady-state allocation; the ticker pauses while the
// tab is hidden. Card art is same-origin (mirrored), so textures load clean.

const PALETTE = [0x8b5cf6, 0xa855f7, 0xc084fc, 0xf5c84c]
const CARD_CAST_SIZE = 24
const FLIP_DURATION_MS = 620
const MASCOT_INTERVAL_MS = 45_000
const MASCOT_TEXTURE_URL = '/assets/emoji/elixir_hype.png'

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

const between = (low: number, high: number) => low + Math.random() * (high - low)

export async function createElixirRain(host: HTMLDivElement): Promise<{ destroy(): void }> {
  const { Application, Assets, Container: PixiContainer, Graphics, Sprite: PixiSprite } = await loadPixi()

  const app = new Application()
  await app.init({
    resizeTo: host,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2)
  })
  app.canvas.className = 'screensaver__canvas'
  app.canvas.setAttribute('aria-hidden', 'true')
  host.appendChild(app.canvas)

  // The page CSP sets worker-src 'none'; keep Pixi's asset loader on the
  // main thread instead of a blob worker.
  Assets.setPreferences({ preferWorkers: false })

  // A fresh random cast of cards every activation.
  const cast = shuffled((rawCards as CardsData).cards.filter((card) => card.icon)).slice(0, CARD_CAST_SIZE)
  const urls = cast.map((card) => card.icon)
  const loaded = await Assets.load<Texture>(urls)
  const textures = urls.map((url) => loaded[url]).filter((texture): texture is Texture => Boolean(texture))
  if (!textures.length) throw new Error('No card textures available for the screensaver')
  let mascotTexture: Texture | undefined
  try {
    mascotTexture = await Assets.load<Texture>(MASCOT_TEXTURE_URL)
  } catch {
    // The cameo is optional garnish.
  }

  const small = app.screen.width < 600
  const randomTexture = () => textures[Math.floor(Math.random() * textures.length)]!

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

  // Mascot cameo: glides across every ~45s with a gentle bob.
  let mascot: Sprite | undefined
  let mascotTimerMs = MASCOT_INTERVAL_MS * 0.6
  let mascotActive = false
  if (mascotTexture) {
    mascot = new PixiSprite(mascotTexture)
    mascot.anchor.set(0.5)
    mascot.scale.set(0.9)
    mascot.visible = false
    app.stage.addChild(mascot)
  }

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

    if (mascot) {
      if (mascotActive) {
        mascot.x += 90 * deltaS
        mascot.y += Math.sin(elapsedS * 2.2) * 0.6
        if (mascot.x > width + mascot.width) {
          mascotActive = false
          mascot.visible = false
          mascotTimerMs = MASCOT_INTERVAL_MS
        }
      } else {
        mascotTimerMs -= ticker.deltaMS
        if (mascotTimerMs <= 0) {
          mascotActive = true
          mascot.visible = true
          mascot.position.set(-mascot.width, between(height * 0.15, height * 0.7))
        }
      }
    }
  }
  app.ticker.add(update)

  const onVisibility = () => {
    if (document.hidden) app.ticker.stop()
    else app.ticker.start()
  }
  document.addEventListener('visibilitychange', onVisibility)

  return {
    destroy() {
      document.removeEventListener('visibilitychange', onVisibility)
      app.destroy(true, { children: true, texture: false })
      void Assets.unload(urls).catch(() => undefined)
    }
  }
}
