import { publishBadgeShare, uploadBadgeShareImage } from './api'
import { sessionToken } from './account'
import { renderBadgeSharePreview } from './share-card'

export interface BadgeShareInput {
  slug: string
  rungIndex: number
}

export async function prepareBadgeShare(input: BadgeShareInput): Promise<string> {
  const session = sessionToken()
  if (!session) throw new Error('Sign in to share a badge.')
  const published = await publishBadgeShare(input.slug, input.rungIndex, session)
  const image = await renderBadgeSharePreview(published.preview)
  if (!image) throw new Error('Badge preview is unavailable.')
  await uploadBadgeShareImage(input.slug, input.rungIndex, image, session)
  return published.url
}
