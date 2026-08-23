// Last-touch recruitment attribution from a valid shared link. The browser
// stores either a legacy six-character invitation token or the deterministic
// public player/run pair from a published run. It expires after 30 days and is
// consumed when a login email is successfully requested; the API decides
// whether the email is truly new.

const RECRUITER_KEY = 'elixirdrop:recruiter:v1'
const RECRUITER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000
const TOKEN_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/

interface StoredRecruiter {
  token?: string
  playerId?: string
  runId?: string
  badgeSlug?: string
  rungIndex?: number
  capturedAt: number
}

export type RecruiterAttribution =
  { token: string } | { playerId: string; runId: string } | { playerId: string; badgeSlug: string; rungIndex: number }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BADGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function rememberRecruiter(token: string, capturedAt = Date.now()): void {
  const normalized = token.toUpperCase()
  if (!TOKEN_PATTERN.test(normalized)) return
  try {
    localStorage.setItem(RECRUITER_KEY, JSON.stringify({ token: normalized, capturedAt } satisfies StoredRecruiter))
  } catch {
    // Attribution is optional; a blocked storage write must never block play.
  }
}

export function recruiterAttribution(now = Date.now()): RecruiterAttribution | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(RECRUITER_KEY) || 'null') as StoredRecruiter | null
    const hasRun = Boolean(stored?.playerId && stored.runId)
    const hasBadge = Boolean(stored?.playerId && stored.badgeSlug && stored.rungIndex !== undefined)
    if (
      !stored ||
      (!stored.token && !hasRun && !hasBadge) ||
      (stored.token !== undefined && !TOKEN_PATTERN.test(stored.token)) ||
      (stored.playerId !== undefined && !UUID_PATTERN.test(stored.playerId)) ||
      (stored.runId !== undefined && !UUID_PATTERN.test(stored.runId)) ||
      (stored.badgeSlug !== undefined && !BADGE_SLUG_PATTERN.test(stored.badgeSlug)) ||
      (stored.rungIndex !== undefined &&
        (!Number.isSafeInteger(stored.rungIndex) || stored.rungIndex < 0 || stored.rungIndex > 100)) ||
      !Number.isFinite(stored.capturedAt) ||
      stored.capturedAt > now ||
      now - stored.capturedAt > RECRUITER_MAX_AGE_MS
    ) {
      localStorage.removeItem(RECRUITER_KEY)
      return undefined
    }
    if (stored.token) return { token: stored.token }
    if (hasRun) return { playerId: stored.playerId!, runId: stored.runId! }
    return { playerId: stored.playerId!, badgeSlug: stored.badgeSlug!, rungIndex: stored.rungIndex! }
  } catch {
    try {
      localStorage.removeItem(RECRUITER_KEY)
    } catch {
      // Storage remains optional.
    }
    return undefined
  }
}

export function recruiterToken(now = Date.now()): string | undefined {
  const attribution = recruiterAttribution(now)
  return attribution && 'token' in attribution ? attribution.token : undefined
}

export function clearRecruiter(): void {
  try {
    localStorage.removeItem(RECRUITER_KEY)
  } catch {
    // Storage remains optional.
  }
}
