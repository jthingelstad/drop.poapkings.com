// Home — one shared view-model (useHomeData), two layout renders. The mobile
// scroll (identity chip → Surge hero → swipe games → practice → standings peek →
// wordmark) and the desktop center stage (Play heading → hero → 2×2 grid) show
// the same data; the identity, standings, and wordmark live in the desktop
// rails instead. Chosen at the 1024px breakpoint by lib/use-layout.

import { layout } from '../lib/use-layout'
import { useHomeData } from './home/home-data'
import HomeMobile from './home/HomeMobile'
import HomeDesktop from './home/HomeDesktop'

export default function Home() {
  const data = useHomeData()
  return layout.value === 'desktop' ? <HomeDesktop data={data} /> : <HomeMobile data={data} />
}
