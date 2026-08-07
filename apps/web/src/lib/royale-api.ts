function royaleApiTag(tag: string): string {
  return encodeURIComponent(tag.trim().replace(/^#/, '').toUpperCase())
}

export function royaleApiPlayerUrl(tag: string): string {
  return `https://royaleapi.com/player/${royaleApiTag(tag)}`
}

export function royaleApiClanUrl(tag: string): string {
  return `https://royaleapi.com/clan/${royaleApiTag(tag)}`
}
