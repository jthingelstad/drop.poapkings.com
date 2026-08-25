export interface ClanInviteResult {
  rank: number
  score: string
}

export interface ClanInviteContext {
  gameName: string
  playerName: string
  clanName?: string
  result?: ClanInviteResult
}

const CLAN_CHAT_DESTINATION = 'DROP . POAPKINGS . COM'

function escapeDiscordMarkdown(value: string): string {
  return value.replace(/([\\`*_~])/g, '\\$1')
}

export function clanChatInviteMessage({ gameName, result }: ClanInviteContext): string {
  if (!result) return `Join me in ${gameName} on our Drop ladder: ${CLAN_CHAT_DESTINATION}`
  return `I'm #${result.rank} in ${gameName} (best: ${result.score}). Beat me on our Drop ladder: ${CLAN_CHAT_DESTINATION}`
}

export function discordInviteMessage(
  { gameName, playerName, clanName, result }: ClanInviteContext,
  profileUrl: string
): string {
  const player = `**${escapeDiscordMarkdown(playerName)}**`
  const ladder = clanName ? `the **${escapeDiscordMarkdown(clanName)} Clan Ladder**` : '**our Clan Ladder**'
  const standing = result
    ? `, currently **#${result.rank} in ${escapeDiscordMarkdown(gameName)}** on ${ladder} (best: **${escapeDiscordMarkdown(result.score)}**)`
    : `, playing **${escapeDiscordMarkdown(gameName)}** on ${ladder}`

  return `I'm ${player}${standing}.\n\nThink you can beat me? [Take the challenge on Elixir Drop](${profileUrl})`
}
