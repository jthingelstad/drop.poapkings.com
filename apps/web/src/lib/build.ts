const rawBuildId =
  typeof __ELIXIR_DROP_BUILD_ID__ !== 'undefined' && __ELIXIR_DROP_BUILD_ID__ ? __ELIXIR_DROP_BUILD_ID__ : 'dev'

const rawBuildDate =
  typeof __ELIXIR_DROP_BUILD_DATE__ !== 'undefined' && __ELIXIR_DROP_BUILD_DATE__ ? __ELIXIR_DROP_BUILD_DATE__ : ''

function formatBuildDate(value: string): string {
  if (!value) return 'Development'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC')
}

export const buildMeta = {
  id: rawBuildId,
  dateIso: rawBuildDate || undefined,
  dateLabel: formatBuildDate(rawBuildDate)
}
