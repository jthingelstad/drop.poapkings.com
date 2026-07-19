import type { Application, Graphics, Ticker } from 'pixi.js'
import { useEffect, useRef } from 'preact/hooks'
import type { GameRuntimeCue } from '../lib/game-runtime'
import { loadPixi } from '../lib/load-pixi'
import { isReducedMotionEnabled } from '../lib/motion'

interface Props {
  cue: GameRuntimeCue | null
  particleCount?: number
}

interface Particle {
  graphic: Graphics
  velocityX: number
  velocityY: number
  gravity: number
  spin: number
  lifeMs: number
  maxLifeMs: number
}

interface FxRuntime {
  app: Application
  particles: Particle[]
  spawnCorrectBurst: () => void
}

export function preloadGameFx(): void {
  if (!isReducedMotionEnabled()) void loadPixi()
}

export default function GameFxLayer({ cue, particleCount = 8 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<FxRuntime | null>(null)
  const handledCueId = useRef(0)
  const pendingCorrectCue = useRef(false)
  const particleCountRef = useRef(particleCount)
  particleCountRef.current = particleCount

  useEffect(() => {
    const host = hostRef.current
    if (!host || isReducedMotionEnabled()) return
    let disposed = false

    void (async () => {
      try {
        const { Application, Graphics } = await loadPixi()
        if (disposed) return

        const app = new Application()
        await app.init({
          resizeTo: host,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2)
        })
        if (disposed) {
          app.destroy(true, true)
          return
        }

        app.canvas.className = 'game-fx-layer__canvas'
        app.canvas.setAttribute('aria-hidden', 'true')
        host.appendChild(app.canvas)

        const particles: Particle[] = []
        const update = (ticker: Ticker) => {
          const seconds = ticker.deltaMS / 1000
          for (let index = particles.length - 1; index >= 0; index -= 1) {
            const particle = particles[index]!
            particle.lifeMs -= ticker.deltaMS
            if (particle.lifeMs <= 0) {
              app.stage.removeChild(particle.graphic)
              particle.graphic.destroy()
              particles.splice(index, 1)
              continue
            }

            particle.velocityY += particle.gravity * seconds
            particle.graphic.x += particle.velocityX * seconds
            particle.graphic.y += particle.velocityY * seconds
            particle.graphic.rotation += particle.spin * seconds
            const remaining = particle.lifeMs / particle.maxLifeMs
            particle.graphic.alpha = Math.min(1, remaining * 1.8)
            particle.graphic.scale.set(0.72 + remaining * 0.28)
          }
        }
        app.ticker.add(update)

        const runtime: FxRuntime = {
          app,
          particles,
          spawnCorrectBurst: () => {
            const originX = app.screen.width / 2
            const originY = app.screen.height * 0.52
            const colors = [0x8b5cf6, 0xa855f7, 0xc084fc, 0xf5c84c]

            for (let index = 0; index < particleCountRef.current; index += 1) {
              const radius = 3.5 + Math.random() * 3.5
              const graphic = new Graphics()
                .circle(0, 0, radius)
                .fill({ color: colors[index % colors.length], alpha: 0.9 })
              const angle = -Math.PI * (0.14 + Math.random() * 0.72)
              const speed = 150 + Math.random() * 210
              const maxLifeMs = 520 + Math.random() * 280

              graphic.position.set(originX + (Math.random() - 0.5) * 56, originY + (Math.random() - 0.5) * 28)
              app.stage.addChild(graphic)
              particles.push({
                graphic,
                velocityX: Math.cos(angle) * speed,
                velocityY: Math.sin(angle) * speed - 80,
                gravity: 430,
                spin: (Math.random() - 0.5) * 5,
                lifeMs: maxLifeMs,
                maxLifeMs
              })
            }
          }
        }

        runtimeRef.current = runtime
        if (pendingCorrectCue.current) {
          pendingCorrectCue.current = false
          runtime.spawnCorrectBurst()
        }
      } catch (error) {
        // Effects are progressive enhancement. Gameplay remains fully usable
        // if WebGL is unavailable or the optional renderer cannot initialize.
        console.warn('Optional game effects could not initialize', error)
      }
    })()

    return () => {
      disposed = true
      const runtime = runtimeRef.current
      runtimeRef.current = null
      runtime?.app.destroy(true, true)
    }
  }, [])

  useEffect(() => {
    if (!cue || handledCueId.current === cue.id || cue.type !== 'answer-correct') return
    handledCueId.current = cue.id
    if (isReducedMotionEnabled()) return
    if (runtimeRef.current) runtimeRef.current.spawnCorrectBurst()
    else pendingCorrectCue.current = true
  }, [cue])

  return <div ref={hostRef} class="game-fx-layer" aria-hidden="true" />
}
