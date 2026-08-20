import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pixi = vi.hoisted(() => {
  class DisplayObject {
    alpha = 1
    height = 100
    rotation = 0
    x = 0
    y = 0
    position = {
      set: vi.fn((x: number, y: number) => {
        this.x = x
        this.y = y
      })
    }
    scale = {
      x: 1,
      set: vi.fn((value: number) => {
        this.scale.x = value
      })
    }
  }

  class Container extends DisplayObject {
    children: DisplayObject[] = []
    addChild(child: DisplayObject) {
      this.children.push(child)
    }
    destroy = vi.fn()
  }

  class Graphics extends DisplayObject {
    circle() {
      return this
    }
    fill() {
      return this
    }
  }

  class Sprite extends DisplayObject {
    anchor = { set: vi.fn() }
    constructor(public texture: object) {
      super()
    }
  }

  class Ticker {
    deltaMS = 16
    maxFPS = 0
    add = vi.fn()
    destroy = vi.fn()
    remove = vi.fn()
    start = vi.fn()
    stop = vi.fn()
  }

  const applications: Application[] = []
  class Application {
    canvas = document.createElement('canvas')
    renderer = { destroy: vi.fn() }
    screen = { width: 1280, height: 720 }
    stage = new Container()
    ticker = new Ticker()
    render = vi.fn()
    constructor() {
      applications.push(this)
    }
    init = vi.fn(async () => undefined)
  }

  const Assets = {
    load: vi.fn(async (urls: string[]) => Object.fromEntries(urls.map((url) => [url, { id: url }]))),
    unload: vi.fn(async () => undefined)
  }

  return { Application, Assets, Container, Graphics, Sprite, applications }
})

vi.mock('../../src/lib/load-pixi', () => ({
  loadPixi: vi.fn(async () => pixi)
}))

import { createElixirRain } from '../../src/components/ScreensaverScene'

describe('Falling Cards scene lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pixi.applications.length = 0
    pixi.Assets.load.mockClear()
    pixi.Assets.unload.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pauses one persistent renderer while off and fully releases it on teardown', async () => {
    const host = document.createElement('div')
    const scene = await createElixirRain(host, { enabled: false, foreground: false })
    const app = pixi.applications[0]!

    expect(host.querySelector('canvas')).toBe(app.canvas)
    expect(app.canvas.hidden).toBe(true)
    expect(app.ticker.maxFPS).toBe(20)
    expect(app.ticker.stop).toHaveBeenCalled()

    scene.setEnabled(true)
    scene.setForeground(true)
    expect(app.canvas.hidden).toBe(false)
    expect(app.ticker.start).toHaveBeenCalled()
    expect(app.ticker.maxFPS).toBe(60)

    // Exercise one ordinary animation frame through the callback registered by
    // the scene rather than duplicating its movement rules in this test.
    const update = app.ticker.add.mock.calls[0]![0] as (ticker: { deltaMS: number }) => void
    update(app.ticker)

    scene.destroy()
    vi.advanceTimersByTime(250)
    await Promise.resolve()

    expect(app.ticker.destroy).toHaveBeenCalled()
    expect(app.stage.destroy).toHaveBeenCalledWith({ children: true })
    expect(app.renderer.destroy).toHaveBeenCalledWith({ removeView: true })
    expect(pixi.Assets.unload).toHaveBeenCalled()
  })
})
