// drop@ is monitored for questions, privacy requests and Fair Play review
// requests. Drop sends no sign-in mail: a Drop account is an Elixir account.
export const ELIXIR_DROP_CONTACT_EMAIL = 'drop@poapkings.com'

export function contactEmailHref(subject?: string): string {
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : ''
  return `mailto:${ELIXIR_DROP_CONTACT_EMAIL}${query}`
}
