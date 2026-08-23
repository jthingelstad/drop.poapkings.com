;(() => {
  const match = /^\/share\/([^/]+)\/badge\/([^/]+)\/([^/]+)$/.exec(window.location.pathname)
  if (!match) return
  const playerId = document.body.dataset.sharePlayerId
  const badgeSlug = document.body.dataset.shareBadgeSlug
  const rungIndex = Number(document.body.dataset.shareBadgeRung)
  if (!playerId || !badgeSlug || !Number.isSafeInteger(rungIndex) || rungIndex < 0) return

  try {
    localStorage.setItem(
      'elixirdrop:recruiter:v1',
      JSON.stringify({ playerId, badgeSlug, rungIndex, capturedAt: Date.now() })
    )
  } catch {
    // Attribution is optional; a blocked storage write must never block play.
  }
})()
