;(() => {
  const match = /^\/share\/(P[0-9A-HJKMNP-TV-Z]{10})\/invite$/.exec(window.location.pathname)
  if (!match) return
  const dropPlayerTag = document.body.dataset.shareDropPlayerTag
  if (!dropPlayerTag || dropPlayerTag.toUpperCase() !== match[1]) return
  try {
    localStorage.setItem(
      'elixirdrop:recruiter:v1',
      JSON.stringify({
        dropPlayerTag: dropPlayerTag.toUpperCase(),
        invite: true,
        capturedAt: Date.now(),
      })
    )
  } catch {
    // Attribution is optional; blocked storage must not block the invitation.
  }
})()
