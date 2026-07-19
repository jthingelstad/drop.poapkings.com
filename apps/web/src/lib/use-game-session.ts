import { useSignal } from '@preact/signals'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import type { GameMode, RunChallenge } from '@elixir-drop/contracts'
import { preloadImages } from './preload'
import { useGameRun } from './use-game-run'
import type { PreparedChallenge } from './game-challenge-content'

type ChallengeFor<T extends GameMode> = Extract<RunChallenge, { mode: T }>

type Resolved<T> = { prepared: PreparedChallenge<T>; error: '' } | { prepared: null; error: string }

export function useGameSession<TMode extends GameMode, TContent>(
  mode: TMode,
  resolve: (challenge: ChallengeFor<TMode>) => PreparedChallenge<TContent>,
  options?: { requireArt?: boolean }
) {
  const run = useGameRun(mode)
  const loadedChallenge = useSignal<ChallengeFor<TMode> | null>(null)
  const artFailed = useSignal(false)
  const preloadGeneration = useRef(0)
  const challenge = run.challenge.value
  const requireArt = options?.requireArt ?? false

  const resolved = useMemo<Resolved<TContent>>(() => {
    if (!challenge) return { prepared: null, error: '' }
    try {
      return { prepared: resolve(challenge), error: '' }
    } catch (error) {
      return {
        prepared: null,
        error: error instanceof Error ? error.message : 'Drop received an invalid signed game challenge.'
      }
    }
  }, [challenge, resolve])

  useEffect(() => {
    const generation = ++preloadGeneration.current
    loadedChallenge.value = null
    artFailed.value = false
    if (!challenge || !resolved.prepared) return
    const assets = resolved.prepared.assets
    preloadImages(assets, (loadedCount) => {
      if (preloadGeneration.current !== generation) return
      // When the art IS the question (Identify), starting the clock against
      // gray fallback boxes is unwinnable; surface a retry instead.
      if (requireArt && assets.length > 0 && loadedCount === 0) {
        artFailed.value = true
        return
      }
      loadedChallenge.value = challenge
    })
    return () => {
      preloadGeneration.current += 1
    }
  }, [artFailed, challenge, loadedChallenge, requireArt, resolved])

  return {
    ...run,
    content: artFailed.value ? null : (resolved.prepared?.content ?? null),
    assetsReady: Boolean(challenge && loadedChallenge.value === challenge),
    error:
      run.startError.value ||
      resolved.error ||
      (artFailed.value ? 'Card art could not be loaded. Check your connection and try again.' : '')
  }
}
