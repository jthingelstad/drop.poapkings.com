;(() => {
  if (!/^\/share\/P[0-9A-HJKMNP-TV-Z]{10}$/.test(window.location.pathname)) return
  const playerId = document.body.dataset.sharePlayerId
  if (!playerId) return

  try {
    localStorage.setItem(
      'elixirdrop:recruiter:v1',
      JSON.stringify({ playerId, profile: true, capturedAt: Date.now() })
    )
  } catch {
    // Attribution is optional; a blocked storage write must never block play.
  }
})()
