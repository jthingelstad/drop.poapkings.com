// Home — one shared view-model and render. Mobile and desktop compose the same
// content differently inside MobileShell; game routes and data never fork.

import { useHomeData } from './home/home-data'
import HomeMobile from './home/HomeMobile'

export default function Home() {
  const data = useHomeData()
  return <HomeMobile data={data} />
}
