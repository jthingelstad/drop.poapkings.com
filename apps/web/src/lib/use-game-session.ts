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
  resolve: (challenge: ChallengeFor<TMode>) => PreparedChallenge<TContent>
) {
  const run = useGameRun(mode)
  const loadedChallenge = useSignal<ChallengeFor<TMode> | null>(null)
  const preloadGeneration = useRef(0)
  const challenge = run.challenge.value

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
    if (!challenge || !resolved.prepared) return
    preloadImages(resolved.prepared.assets, () => {
      if (preloadGeneration.current === generation) loadedChallenge.value = challenge
    })
    return () => {
      preloadGeneration.current += 1
    }
  }, [challenge, loadedChallenge, resolved])

  return {
    ...run,
    content: resolved.prepared?.content ?? null,
    assetsReady: Boolean(challenge && loadedChallenge.value === challenge),
    error: run.startError.value || resolved.error
  }
}
