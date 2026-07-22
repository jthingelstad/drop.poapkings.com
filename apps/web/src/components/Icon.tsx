import arrowDown from 'lucide-static/icons/arrow-down.svg?raw'
import arrowLeft from 'lucide-static/icons/arrow-left.svg?raw'
import arrowRight from 'lucide-static/icons/arrow-right.svg?raw'
import arrowUp from 'lucide-static/icons/arrow-up.svg?raw'
import award from 'lucide-static/icons/award.svg?raw'
import check from 'lucide-static/icons/check.svg?raw'
import chevronDown from 'lucide-static/icons/chevron-down.svg?raw'
import chevronLeft from 'lucide-static/icons/chevron-left.svg?raw'
import chevronRight from 'lucide-static/icons/chevron-right.svg?raw'
import chevronUp from 'lucide-static/icons/chevron-up.svg?raw'
import clock from 'lucide-static/icons/clock.svg?raw'
import download from 'lucide-static/icons/download.svg?raw'
import flame from 'lucide-static/icons/flame.svg?raw'
import gamepad from 'lucide-static/icons/gamepad-2.svg?raw'
import loaderCircle from 'lucide-static/icons/loader-circle.svg?raw'
import logIn from 'lucide-static/icons/log-in.svg?raw'
import logOut from 'lucide-static/icons/log-out.svg?raw'
import pencil from 'lucide-static/icons/pencil.svg?raw'
import play from 'lucide-static/icons/play.svg?raw'
import scanEye from 'lucide-static/icons/scan-eye.svg?raw'
import search from 'lucide-static/icons/search.svg?raw'
import share from 'lucide-static/icons/share.svg?raw'
import settings from 'lucide-static/icons/settings.svg?raw'
import skull from 'lucide-static/icons/skull.svg?raw'
import sparkles from 'lucide-static/icons/sparkles.svg?raw'
import star from 'lucide-static/icons/star.svg?raw'
import target from 'lucide-static/icons/target.svg?raw'
import timer from 'lucide-static/icons/timer.svg?raw'
import trendingDown from 'lucide-static/icons/trending-down.svg?raw'
import trendingUp from 'lucide-static/icons/trending-up.svg?raw'
import triangleAlert from 'lucide-static/icons/triangle-alert.svg?raw'
import trophy from 'lucide-static/icons/trophy.svg?raw'
import user from 'lucide-static/icons/user.svg?raw'
import x from 'lucide-static/icons/x.svg?raw'
import zap from 'lucide-static/icons/zap.svg?raw'

// Lucide glyphs, inlined at build time so the bundle stays self-contained.
// Strokes use currentColor and size follows font-size (see .icon CSS).
const ICONS = {
  'arrow-down': arrowDown,
  'arrow-left': arrowLeft,
  'arrow-right': arrowRight,
  'arrow-up': arrowUp,
  award,
  check,
  'chevron-down': chevronDown,
  'chevron-left': chevronLeft,
  'chevron-right': chevronRight,
  'chevron-up': chevronUp,
  clock,
  download,
  flame,
  gamepad,
  'loader-circle': loaderCircle,
  'log-in': logIn,
  'log-out': logOut,
  pencil,
  play,
  'scan-eye': scanEye,
  search,
  share,
  settings,
  skull,
  sparkles,
  star,
  target,
  timer,
  'trending-down': trendingDown,
  'trending-up': trendingUp,
  'triangle-alert': triangleAlert,
  trophy,
  user,
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
