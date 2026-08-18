// Home — one shared view-model (useHomeData), one render. The redesign collapsed
// the app to a single phone column, so HomeMobile is the one true Home on every
// width; desktop simply letterboxes it (see MobileShell + the desktop aside).
// The old desktop-only 3-column home was retired with the desktop shell.

import { useHomeData } from './home/home-data'
import HomeMobile from './home/HomeMobile'

export default function Home() {
  const data = useHomeData()
  return <HomeMobile data={data} />
}
