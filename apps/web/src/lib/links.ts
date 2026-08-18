// Player contact and transactional delivery deliberately use different
// mailboxes. drop@ is monitored for questions and Fair Play review requests;
// elixir@ is the recognizable sender for one-time sign-in links.
export const ELIXIR_DROP_CONTACT_EMAIL = 'drop@poapkings.com'
export const ELIXIR_DROP_MAGIC_LINK_FROM_EMAIL = 'elixir@poapkings.com'

export function contactEmailHref(subject?: string): string {
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : ''
  return `mailto:${ELIXIR_DROP_CONTACT_EMAIL}${query}`
}

// The POAP KINGS clan invite. The clan is often full, so recruitment leads with
// Discord elsewhere; this is the direct join link when there is room.
export const CLAN_INVITE_URL = 'https://link.clashroyale.com/invite/clan/en?tag=J2RGCRVG&token=dtw94pzg'
