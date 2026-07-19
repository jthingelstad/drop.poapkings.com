// One cached, lazily-loaded pixi.js module for every WebGL surface (game
// effects, screensaver). The unsafe-eval build must load first so Pixi works
// under the page CSP.
let pixiModule: Promise<typeof import('pixi.js')> | undefined

export function loadPixi(): Promise<typeof import('pixi.js')> {
  pixiModule ??= Promise.all([import('pixi.js/unsafe-eval'), import('pixi.js')]).then(([, pixi]) => pixi)
  return pixiModule
}
