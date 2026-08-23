// Last-touch recruitment attribution from a valid shared link. The browser
// stores only the six-character public share token, never either player's
// identity. It expires after 30 days and is consumed when a login email is
// successfully requested; the API decides whether the email is truly new.

const RECRUITER_KEY = 'elixirdrop:recruiter:v1'
const RECRUITER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000
const TOKEN_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/

interface StoredRecruiter {
  token: string
  capturedAt: number
}

export function rememberRecruiter(token: string, capturedAt = Date.now()): void {
  const normalized = token.toUpperCase()
  if (!TOKEN_PATTERN.test(normalized)) return
  try {
    localStorage.setItem(RECRUITER_KEY, JSON.stringify({ token: normalized, capturedAt } satisfies StoredRecruiter))
  } catch {
    // Attribution is optional; a blocked storage write must never block play.
  }
}

export function recruiterToken(now = Date.now()): string | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(RECRUITER_KEY) || 'null') as StoredRecruiter | null
    if (
      !stored ||
      !TOKEN_PATTERN.test(stored.token) ||
      !Number.isFinite(stored.capturedAt) ||
      stored.capturedAt > now ||
      now - stored.capturedAt > RECRUITER_MAX_AGE_MS
    ) {
      localStorage.removeItem(RECRUITER_KEY)
      return undefined
    }
    return stored.token
  } catch {
    try {
      localStorage.removeItem(RECRUITER_KEY)
    } catch {
      // Storage remains optional.
    }
    return undefined
  }
}

export function clearRecruiter(): void {
  try {
    localStorage.removeItem(RECRUITER_KEY)
  } catch {
    // Storage remains optional.
  }
}
