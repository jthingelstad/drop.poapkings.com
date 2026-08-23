(() => {
  const match = /^\/share\/([^/]+)\/([^/]+)$/.exec(window.location.pathname)
  if (!match) return
  const playerTag = match[1]
  const runTag = match[2]
  const playerId = document.body.dataset.sharePlayerId
  const runId = document.body.dataset.shareRunId
  if (!playerId || !runId) return

  try {
    localStorage.setItem(
      'elixirdrop:recruiter:v1',
      JSON.stringify({ playerId, runId, capturedAt: Date.now() })
    )
  } catch {
    // Attribution is optional; a blocked storage write must never block play.
  }

  const headers = { 'content-type': 'application/json' }
  try {
    const session = JSON.parse(localStorage.getItem('elixirdrop:session:v1') || 'null')
    if (
      session &&
      typeof session.token === 'string' &&
      typeof session.expiresAt === 'string' &&
      Date.parse(session.expiresAt) > Date.now()
    ) {
      headers.authorization = `Bearer ${session.token}`
    }
  } catch {
    // An invalid local session is equivalent to an anonymous open.
  }
  fetch(`/share/${encodeURIComponent(playerTag)}/${encodeURIComponent(runTag)}/open`, {
    method: 'POST',
    headers,
    body: '{}',
    keepalive: true
  }).catch(() => {
    // Reach is best-effort; the shared run remains readable without it.
  })
})()
