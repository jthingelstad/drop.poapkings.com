import { layout } from './use-layout'

export function practiceLandingPath(): '/' | '/practice' {
  return layout.value === 'desktop' ? '/practice' : '/'
}
