import { animate, type AnimationPlaybackControls } from 'motion'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import type { GameRuntimeCue } from '../lib/game-runtime'
import { isReducedMotionEnabled } from '../lib/motion'

export type GameMotionPreset = 'card' | 'reveal' | 'pair' | 'board' | 'ladder' | 'grid'

interface Props {
  contentKey?: string | number
  cue: GameRuntimeCue | null
  children: ComponentChildren
  preset?: GameMotionPreset
  className?: string
}

const wrongTransforms: Record<GameMotionPreset, string[]> = {
  card: [
    'translate3d(0, 0, 0) rotate(0deg)',
    'translate3d(-13px, 0, 0) rotate(-1.8deg)',
    'translate3d(11px, 0, 0) rotate(1.4deg)',
    'translate3d(-8px, 0, 0) rotate(-1deg)',
    'translate3d(5px, 0, 0) rotate(0.6deg)',
    'translate3d(0, 0, 0) rotate(0deg)'
  ],
  reveal: [
    'translate3d(0, 0, 0) rotate(0deg)',
    'translate3d(-10px, 0, 0) rotate(-1.2deg)',
    'translate3d(8px, 0, 0) rotate(0.9deg)',
    'translate3d(-4px, 0, 0) rotate(-0.4deg)',
    'translate3d(0, 0, 0) rotate(0deg)'
  ],
  pair: [
    'translate3d(0, 0, 0)',
    'translate3d(-12px, 0, 0)',
    'translate3d(10px, 0, 0)',
    'translate3d(-6px, 0, 0)',
    'translate3d(0, 0, 0)'
  ],
  board: ['translate3d(0, 0, 0)', 'translate3d(-9px, 0, 0)', 'translate3d(7px, 0, 0)', 'translate3d(0, 0, 0)'],
  ladder: [
    'translate3d(0, 0, 0)',
    'translate3d(-8px, 0, 0)',
    'translate3d(7px, 0, 0)',
    'translate3d(-3px, 0, 0)',
    'translate3d(0, 0, 0)'
  ],
  grid: [
    'translate3d(0, 0, 0) scale(1)',
    'translate3d(-6px, 0, 0) scale(0.992)',
    'translate3d(5px, 0, 0) scale(0.992)',
    'translate3d(0, 0, 0) scale(1)'
  ]
}

function enterAnimation(preset: GameMotionPreset) {
  switch (preset) {
    case 'card':
      return {
        opacity: [0, 1],
        transform: [
          'translate3d(0, 68px, 0) rotate(-2deg) scale(0.96)',
          'translate3d(0, -5px, 0) rotate(0.4deg) scale(1.01)',
          'translate3d(0, 0, 0) rotate(0deg) scale(1)'
        ]
      }
    case 'pair':
      return {
        opacity: [0, 1],
        transform: ['translate3d(42px, 0, 0) scale(0.98)', 'translate3d(0, 0, 0) scale(1)']
      }
    case 'ladder':
      return {
        opacity: [0.7, 1],
        transform: ['translate3d(0, 18px, 0) scale(0.99)', 'translate3d(0, 0, 0) scale(1)']
      }
    case 'grid':
      return { opacity: [0.72, 1], transform: ['scale(0.96)', 'scale(1)'] }
    case 'board':
    case 'reveal':
      return {
        opacity: [0.72, 1],
        transform: ['translate3d(0, 22px, 0) scale(0.98)', 'translate3d(0, 0, 0) scale(1)']
      }
  }
}

function correctAnimation(preset: GameMotionPreset) {
  if (preset === 'card') {
    return {
      opacity: [1, 1, 0],
      transform: [
        'translate3d(0, 0, 0) rotate(0deg) scale(1)',
        'translate3d(0, -12px, 0) rotate(-1deg) scale(1.025)',
        'translate3d(0, -72vh, 0) rotate(7deg) scale(0.9)'
      ]
    }
  }

  if (preset === 'pair') {
    return {
      opacity: [1, 0.78, 1],
      transform: [
        'translate3d(0, 0, 0) scale(1)',
        'translate3d(-16px, 0, 0) scale(1.01)',
        'translate3d(0, 0, 0) scale(1)'
      ]
    }
  }

  if (preset === 'ladder') {
    return {
      opacity: [1, 0.82, 1],
      transform: [
        'translate3d(0, 0, 0) scale(1)',
        'translate3d(0, -8px, 0) scale(1.012)',
        'translate3d(0, 0, 0) scale(1)'
      ]
    }
  }

  return {
    opacity: [1, 0.78, 1],
    transform: [
      'translate3d(0, 0, 0) scale(1)',
      'translate3d(0, -4px, 0) scale(1.018)',
      'translate3d(0, 0, 0) scale(1)'
    ]
  }
}

export default function GameMotion({ contentKey, cue, children, preset = 'card', className = '' }: Props) {
  const elementRef = useRef<HTMLDivElement>(null)
  const previousContentKey = useRef(contentKey)
  const handledCueId = useRef(0)
  const animation = useRef<AnimationPlaybackControls | null>(null)

  useEffect(() => {
    const element = elementRef.current
    if (!element || previousContentKey.current === contentKey) return
    previousContentKey.current = contentKey
    animation.current?.stop()

    if (isReducedMotionEnabled()) {
      animation.current = animate(element, { opacity: [0.65, 1] }, { duration: 0.12, ease: 'easeOut' })
      return
    }

    animation.current = animate(element, enterAnimation(preset), {
      duration: preset === 'card' ? 0.24 : 0.28,
      ease: [0.22, 0.8, 0.24, 1]
    })
  }, [contentKey, preset])

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
        { transform: wrongTransforms[preset] },
        { duration: 0.36, ease: 'easeInOut' }
      )
      return
    }

    animation.current = animate(element, correctAnimation(preset), {
      duration: preset === 'card' ? 0.26 : 0.38,
      ease: [0.32, 0, 0.2, 1]
    })
  }, [cue, preset])

  useEffect(
    () => () => {
      animation.current?.stop()
    },
    []
  )

  return (
    <div ref={elementRef} class={`game-motion game-motion--${preset}${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}
