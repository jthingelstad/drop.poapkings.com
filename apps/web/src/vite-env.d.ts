/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DISABLE_UPDATE_NOTICE?: string
}

declare const __ELIXIR_DROP_BUILD_ID__: string | undefined
declare const __ELIXIR_DROP_BUILD_DATE__: string | undefined

declare module 'pixi.js/unsafe-eval'
