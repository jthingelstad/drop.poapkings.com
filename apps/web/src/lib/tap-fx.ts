// Tap FX — the satisfying button feedback from the prototypes: a spring
// overshoot on the button face, an expanding gold ring, and a short spray of
// elixir droplets. Implemented with the Web Animations API (no CDN motion lib);
// reduced-motion is a hard no-op so nothing animates when the player opts out.
//
// Usage: give the button `class="tap-fx"` (position:relative) and an inner
// `.tap-face` element to scale, then call `tapFx(buttonEl)` from the handler.

import { isReducedMotionEnabled } from './motion'

const DROP_SHAPE = '50% 50% 50% 50% / 40% 40% 60% 60%'

function springFace(btn: HTMLElement): void {
  const face = (btn.querySelector('.tap-face') as HTMLElement | null) ?? btn
  face.animate(
    { transform: ['scale(0.9)', 'scale(1.06)', 'scale(1)'] },
    { duration: 340, easing: 'cubic-bezier(0.34, 1.5, 0.5, 1)' }
  )
}

function goldRing(btn: HTMLElement): void {
  const ring = document.createElement('span')
  ring.style.cssText =
    'position:absolute;left:50%;top:50%;width:54px;height:54px;border-radius:50%;' +
    'border:2px solid rgba(245,200,76,0.85);transform:translate(-50%,-50%);' +
    'pointer-events:none;z-index:6;'
  btn.appendChild(ring)
  ring
    .animate(
      {
        transform: ['translate(-50%,-50%) scale(0.5)', 'translate(-50%,-50%) scale(2.2)'],
        opacity: [0.85, 0]
      },
      { duration: 460, easing: 'ease-out' }
    )
    .finished.then(() => ring.remove())
    .catch(() => ring.remove())
}

function elixirSpray(btn: HTMLElement, count = 6): void {
  for (let i = 0; i < count; i++) {
    const d = document.createElement('span')
    d.style.cssText =
      'position:absolute;left:50%;top:50%;width:8px;height:11px;border-radius:' +
      DROP_SHAPE +
      ';background:linear-gradient(180deg,#e7ddff,#8b5cf6);transform:translate(-50%,-50%);' +
      'pointer-events:none;z-index:6;'
    btn.appendChild(d)
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2
    const dist = 22 + Math.random() * 28
    const dx = Math.cos(ang) * dist
    const dy = Math.sin(ang) * dist
    d.animate(
      {
        transform: [
          'translate(-50%,-50%) scale(1)',
          `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.35)`
        ],
        opacity: [1, 0]
      },
      { duration: 500 + Math.random() * 250, easing: 'ease-out' }
    )
      .finished.then(() => d.remove())
      .catch(() => d.remove())
  }
}

// Full tap FX (spring + ring + spray). No-op under reduced motion.
export function tapFx(btn: HTMLElement | null | undefined): void {
  if (!btn || isReducedMotionEnabled()) return
  springFace(btn)
  goldRing(btn)
  elixirSpray(btn)
}

// Convenience for event handlers: `onClick={(e) => tapFxFrom(e)}`.
export function tapFxFrom(e: { currentTarget?: EventTarget | null }): void {
  const t = e?.currentTarget
  if (t instanceof HTMLElement) tapFx(t)
}
