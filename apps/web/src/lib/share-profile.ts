import { publishProfileShare, uploadProfileShareImage } from './api'
import { sessionToken } from './account'
import { renderProfileSharePreview } from './share-card'

// Publishing refreshes the permanent profile snapshot before the link opens,
// so Arena, Player XP, and badge highlights are current at share time.
export async function prepareProfileShare(): Promise<string> {
  const session = sessionToken()
  if (!session) throw new Error('Sign in to share your player profile.')
  const published = await publishProfileShare(session)
  const image = await renderProfileSharePreview(published.preview)
  if (!image) throw new Error('Profile preview is unavailable.')
  await uploadProfileShareImage(image, session)
  return published.url
}
