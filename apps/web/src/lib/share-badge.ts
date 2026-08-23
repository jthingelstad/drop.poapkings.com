import { publishBadgeShare, uploadBadgeShareImage } from './api'
import { sessionToken } from './account'
import { renderBadgeSharePreview } from './share-card'
import { shareLink, type RunShareOutcome } from './share-run'

export interface BadgeShareInput {
  slug: string
  rungIndex: number
}

export async function shareBadge(input: BadgeShareInput): Promise<RunShareOutcome> {
  const session = sessionToken()
  if (!session) return 'unavailable'
  try {
    const published = await publishBadgeShare(input.slug, input.rungIndex, session)
    const image = await renderBadgeSharePreview(published.preview)
    if (!image) return 'unavailable'
    await uploadBadgeShareImage(input.slug, input.rungIndex, image, session)
    return shareLink(published.url)
  } catch {
    return 'unavailable'
  }
}
