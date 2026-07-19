import arrowDown from 'lucide-static/icons/arrow-down.svg?raw'
import arrowRight from 'lucide-static/icons/arrow-right.svg?raw'
import arrowUp from 'lucide-static/icons/arrow-up.svg?raw'
import check from 'lucide-static/icons/check.svg?raw'
import chevronDown from 'lucide-static/icons/chevron-down.svg?raw'
import chevronUp from 'lucide-static/icons/chevron-up.svg?raw'
import flame from 'lucide-static/icons/flame.svg?raw'
import loaderCircle from 'lucide-static/icons/loader-circle.svg?raw'
import logIn from 'lucide-static/icons/log-in.svg?raw'
import settings from 'lucide-static/icons/settings.svg?raw'
import sparkles from 'lucide-static/icons/sparkles.svg?raw'
import target from 'lucide-static/icons/target.svg?raw'
import timer from 'lucide-static/icons/timer.svg?raw'
import trendingDown from 'lucide-static/icons/trending-down.svg?raw'
import triangleAlert from 'lucide-static/icons/triangle-alert.svg?raw'
import trophy from 'lucide-static/icons/trophy.svg?raw'
import x from 'lucide-static/icons/x.svg?raw'
import zap from 'lucide-static/icons/zap.svg?raw'

// Lucide glyphs, inlined at build time so the bundle stays self-contained.
// Strokes use currentColor and size follows font-size (see .icon CSS).
const ICONS = {
  'arrow-down': arrowDown,
  'arrow-right': arrowRight,
  'arrow-up': arrowUp,
  check,
  'chevron-down': chevronDown,
  'chevron-up': chevronUp,
  flame,
  'loader-circle': loaderCircle,
  'log-in': logIn,
  settings,
  sparkles,
  target,
  timer,
  'trending-down': trendingDown,
  'triangle-alert': triangleAlert,
  trophy,
  x,
  zap
} as const

export type IconName = keyof typeof ICONS

export default function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <span
      class={className ? `icon ${className}` : 'icon'}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  )
}
