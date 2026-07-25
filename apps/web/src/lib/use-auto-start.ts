import { useCallback, useEffect, useRef } from 'preact/hooks'
import type { Signal } from '@preact/signals'
import type { GameRuntimeStage } from './game-runtime'

// No manual "ready" screen in the redesign: Play → countdown. A mode auto-starts
// as soon as its signed challenge and card art are loaded, exactly once, and
// re-arms on replay.
//
// The stage is read with `peek()` on purpose. Subscribing to it would re-run
// this on every stage flip, and the flip back to 'ready' during replay would
// re-trigger the start before the fresh challenge has been dealt.
//
// Returns `rearm`, which the mode's replay() calls so the next loaded challenge
// starts itself again.
export function useAutoStart(ready: boolean, stage: Signal<GameRuntimeStage>, start: () => void): () => void {
  const started = useRef(false)
  // start() closes over the mode's signals, so it is reached through a ref and
  // this only re-fires on load state.
  const latest = useRef(start)
  latest.current = start

  useEffect(() => {
    if (!ready || started.current || stage.peek() !== 'ready') return
    started.current = true
    latest.current()
  }, [ready, stage])

  return useCallback(() => {
    started.current = false
  }, [])
}
