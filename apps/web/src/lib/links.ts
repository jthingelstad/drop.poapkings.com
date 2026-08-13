export const ELIXIR_DROP_DISCORD_URL = 'https://discord.gg/SdvKfJW5kA'

// Player contact and transactional delivery deliberately use different
// mailboxes. drop@ is monitored for questions and Fair Play review requests;
// elixir@ is the recognizable sender for one-time sign-in links.
export const ELIXIR_DROP_CONTACT_EMAIL = 'drop@poapkings.com'
export const ELIXIR_DROP_MAGIC_LINK_FROM_EMAIL = 'elixir@poapkings.com'

export function contactEmailHref(subject?: string): string {
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : ''
  return `mailto:${ELIXIR_DROP_CONTACT_EMAIL}${query}`
}
