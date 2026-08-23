const TOKEN_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/

export function sharePermalink(kind: 'r' | 's', token: string, href = window.location.href): string {
  const url = new URL(href)
  url.search = ''
  url.hash = `/${kind}/${token}`
  return url.toString()
}

export function shareTokenFromRoute(value: string, kind: 'r' | 's'): string | undefined {
  const match = value.match(new RegExp(`^/${kind}/([^/?#]+)`))
  const token = match?.[1]?.toUpperCase()
  return token && TOKEN_PATTERN.test(token) ? token : undefined
}
