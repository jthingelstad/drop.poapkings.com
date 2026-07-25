// The body of the /releases meta page: one section card per named release,
// newest first, in the same chrome About and FAQ use. Entries are passed in so
// the empty state is a real, testable render path rather than a branch nobody
// can reach until releases.json is empty.

import MetaSection from './MetaSection'
import { RELEASES } from '../data/meta-content'
import { releaseDateLabel, type ReleaseEntry } from '../lib/releases'

export default function ReleaseList({ entries }: { entries: ReleaseEntry[] }) {
  return (
    <div class="ed-meta-sections">
      <p class="ed-page__intro">{RELEASES.intro}</p>
      {entries.length === 0 ? (
        <MetaSection title="Nothing released yet" muted>
          <p>{RELEASES.empty}</p>
        </MetaSection>
      ) : (
        entries.map((entry) => (
          <MetaSection title={entry.name} key={entry.id}>
            <p class="ed-release__stamp">
              {releaseDateLabel(entry.date)} · build <code>{entry.build}</code>
            </p>
            {entry.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </MetaSection>
        ))
      )}
    </div>
  )
}
