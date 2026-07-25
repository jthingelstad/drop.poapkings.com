// One cached, lazily-loaded pixi.js module for every WebGL surface (game
// effects, screensaver). The unsafe-eval build must load first so Pixi works
// under the page CSP.
let pixiModule: Promise<typeof import('pixi.js')> | undefined

export function loadPixi(): Promise<typeof import('pixi.js')> {
  pixiModule ??= Promise.all([import('pixi.js/unsafe-eval'), import('pixi.js')]).then(([, pixi]) => {
    // The page CSP sets worker-src 'none'. Assets is a Pixi-wide singleton, so
    // the preference belongs here rather than in one surface's init: otherwise
    // whichever of the game-effects layer or the screensaver mounts first
    // decides whether the other gets a blob worker and a CSP violation.
    pixi.Assets.setPreferences({ preferWorkers: false })
    return pixi
  })
  return pixiModule
}
