// Typed view of the committed editorial messages (`src/data/messages.json`).
// Same idea as releases.ts: a static, hand-edited file that ships with a deploy.
// There is no endpoint and no per-player message store — editorial goes out with
// the build, and the Updates view merges it with the release history by date.

import raw from '../data/messages.json'

export interface MessageEntry {
  // Stable, unique slug for the message.
  id: string
  // ISO date (YYYY-MM-DD) the message is dated.
  date: string
  // The subject line.
  title: string
  // Short player-facing paragraphs.
  body: string[]
}

interface MessagesFile {
  schemaVersion: number
  messages: MessageEntry[]
}

// Newest first.
export const messages: MessageEntry[] = [...(raw as MessagesFile).messages].sort((left, right) =>
  right.date.localeCompare(left.date)
)
