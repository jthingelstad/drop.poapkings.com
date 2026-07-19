import { animate, type AnimationPlaybackControls } from 'motion'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import type { GameRuntimeCue } from '../lib/game-runtime'
import { isReducedMotionEnabled } from '../lib/motion'

interface Props {
  cardKey: string | number
  cue: GameRuntimeCue | null
  children: ComponentChildren
  className?: string
}

export default function GameCardMotion({ cardKey, cue, children, className = '' }: Props) {
  const elementRef = useRef<HTMLDivElement>(null)
  const previousCardKey = useRef(cardKey)
  const handledCueId = useRef(0)
  const animation = useRef<AnimationPlaybackControls | null>(null)

  useEffect(() => {
    const element = elementRef.current
    if (!element || previousCardKey.current === cardKey) return
    previousCardKey.current = cardKey
    animation.current?.stop()

    if (isReducedMotionEnabled()) {
      animation.current = animate(element, { opacity: [0.65, 1] }, { duration: 0.12, ease: 'easeOut' })
      return
    }

    animation.current = animate(
      element,
      {
        opacity: [0, 1],
        transform: [
          'translate3d(0, 68px, 0) rotate(-2deg) scale(0.96)',
          'translate3d(0, -5px, 0) rotate(0.4deg) scale(1.01)',
          'translate3d(0, 0, 0) rotate(0deg) scale(1)'
        ]
      },
      { duration: 0.24, ease: [0.22, 0.8, 0.24, 1] }
    )
  }, [cardKey])

  useEffect(() => {
    const element = elementRef.current
    if (!element || !cue || handledCueId.current === cue.id) return
    handledCueId.current = cue.id
    if (cue.type !== 'answer-correct' && cue.type !== 'answer-wrong') return

    animation.current?.stop()

    if (isReducedMotionEnabled()) {
      animation.current = animate(element, { opacity: [1, 0.72, 1] }, { duration: 0.16, ease: 'linear' })
      return
    }

    if (cue.type === 'answer-wrong') {
      animation.current = animate(
        element,
        {
          transform: [
            'translate3d(0, 0, 0) rotate(0deg)',
            'translate3d(-13px, 0, 0) rotate(-1.8deg)',
            'translate3d(11px, 0, 0) rotate(1.4deg)',
            'translate3d(-8px, 0, 0) rotate(-1deg)',
            'translate3d(5px, 0, 0) rotate(0.6deg)',
            'translate3d(0, 0, 0) rotate(0deg)'
          ]
        },
        { duration: 0.36, ease: 'easeInOut' }
      )
      return
    }

    animation.current = animate(
      element,
      {
        opacity: [1, 1, 0],
        transform: [
          'translate3d(0, 0, 0) rotate(0deg) scale(1)',
          'translate3d(0, -12px, 0) rotate(-1deg) scale(1.025)',
          'translate3d(0, -72vh, 0) rotate(7deg) scale(0.9)'
        ]
      },
      { duration: 0.26, ease: [0.32, 0, 0.2, 1] }
    )
  }, [cue])

  useEffect(
    () => () => {
      animation.current?.stop()
    },
    []
  )

  return (
    <div ref={elementRef} class={`game-card-motion${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}
