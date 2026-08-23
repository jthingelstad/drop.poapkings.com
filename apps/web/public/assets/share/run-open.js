(() => {
  const match = /^\/share\/([^/]+)\/([^/]+)$/.exec(window.location.pathname)
  if (!match) return
  const playerId = match[1]
  const runId = match[2]
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuid.test(playerId) || !uuid.test(runId)) return

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
  fetch(`/share/${encodeURIComponent(playerId)}/${encodeURIComponent(runId)}/open`, {
    method: 'POST',
    headers,
    body: '{}',
    keepalive: true
  }).catch(() => {
    // Reach is best-effort; the shared run remains readable without it.
  })
})()
