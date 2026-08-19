import { useEffect, useState } from 'preact/hooks'
import type { GamePath } from '../lib/game-routes'
import { boardRouteForMode } from '../lib/game-routes'
import { GAMES } from '../lib/game-metadata'
import { navigate } from '../lib/router'
import { practiceEntryPath } from '../lib/practice-navigation'
import ModeIcon from './ModeIcon'

// The ranked touch-only gate, with a way across.
//
// The gate itself already shipped (supportsTouchPlay lets a touchscreen desktop
// through and stops everyone else); what it lacked was a bridge. A code is
// faster than dictating a URL to yourself, and it opens THAT MODE rather than
// the home page — a player who came for Rain should land on Rain.
//
// The reason is stated once, plainly. A player who understands why ranked is a
// thumb game stops reading the gate as a missing feature. And there are two ways
// out that are not the phone, because "go and get your phone" cannot be the only
// thing a screen offers.

// The QR encoder is loaded only here. The gate is reached by a mouse-only
// desktop and by nobody else, so the encoder must never ride in the shell chunk
// that every phone player downloads.
function useQrMatrix(url: string) {
  const [matrix, setMatrix] = useState<{ path: string; count: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    void import('qrcode-generator')
      .then(({ default: qrcode }) => {
        if (cancelled) return
        // Type 0 = automatic size; 'M' error correction survives a phone camera
        // at an angle without inflating the module count.
        const qr = qrcode(0, 'M')
        qr.addData(url)
        qr.make()
        const count = qr.getModuleCount()
        let path = ''
        for (let row = 0; row < count; row += 1) {
          for (let col = 0; col < count; col += 1) {
            if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`
          }
        }
        setMatrix({ path, count })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [url])
  return matrix
}

// The app is hash-routed on GitHub Pages, so a mode's shareable address is the
// origin plus its hash route. There is no server to rewrite a prettier path.
export function rankedModeUrl(path: GamePath, origin = window.location.origin): string {
  return `${origin}/#${path}`
}

export function rankedModeUrlLabel(path: GamePath, origin = window.location.origin): string {
  return rankedModeUrl(path, origin).replace(/^https?:\/\//, '')
}

export default function RankedTouchGate({ path }: { path: GamePath }) {
  const game = GAMES.find((candidate) => candidate.path === path)
  const name = game?.name ?? 'Ranked'
  const url = typeof window === 'undefined' ? `/#${path}` : rankedModeUrl(path)
  const matrix = useQrMatrix(url)

  return (
    <div class="main-content">
      <section class="ed-touchgate">
        <div class="ed-touchgate__body">
          <div class="ed-touchgate__eyebrow">
            {game && <ModeIcon mode={game.mode} size={30} />}
            <span>{name} · ranked</span>
          </div>
          <h2 class="ed-touchgate__title">{name} is a thumb game</h2>
          <p class="ed-touchgate__reason">
            Every ranked run is played on a keypad built for two thumbs and timed to the millisecond, so the board
            compares like with like.
          </p>
          <p class="ed-touchgate__scan">Scan to open {name} on your phone.</p>
          <div class="ed-touchgate__outs">
            <button class="ed-btn ed-btn--ghost" onClick={() => navigate(practiceEntryPath())}>
              Practice instead
            </button>
            {game && (
              <button class="ed-textlink" type="button" onClick={() => navigate(boardRouteForMode(game.mode))}>
                Open the {name} board
              </button>
            )}
          </div>
        </div>
        <div class="ed-touchgate__code">
          <div class="ed-touchgate__qr">
            {matrix && (
              <svg
                viewBox={`0 0 ${matrix.count} ${matrix.count}`}
                role="img"
                aria-label={`QR code opening ${name} at ${url}`}
              >
                <path d={matrix.path} fill="currentColor" />
              </svg>
            )}
          </div>
          <span class="ed-touchgate__url">{typeof window === 'undefined' ? url : rankedModeUrlLabel(path)}</span>
        </div>
      </section>
    </div>
  )
}
