// Static meta pages (About / Releases / FAQ / Install), rendered from the single
// content module (data/meta-content.ts). Same component on both shells: mobile
// shows it as a full sub-screen with a back arrow; desktop renders it in the
// center stage. No game, auth, or leaderboard logic here. Releases adds one
// data source — the tool-written history in lib/releases.ts.

import MetaPageHead from '../components/MetaPageHead'
import MetaSection from '../components/MetaSection'
import ReleaseList from '../components/ReleaseList'
import { ABOUT, FAQ, INSTALL, RELEASES } from '../data/meta-content'
import { contactEmailHref, ELIXIR_DROP_CONTACT_EMAIL, ELIXIR_DROP_MAGIC_LINK_FROM_EMAIL } from '../lib/links'
import { releases } from '../lib/releases'

export type MetaPageKind = 'about' | 'releases' | 'faq' | 'install'

function AboutBody() {
  return (
    <div class="ed-meta-sections">
      {ABOUT.sections.map((section) => (
        <MetaSection title={section.title} key={section.title}>
          <p>{section.body}</p>
        </MetaSection>
      ))}
      <MetaSection title="Contact Drop">
        <p>
          Questions, feedback, privacy requests, or help with a result? Email{' '}
          <a href={contactEmailHref()}>{ELIXIR_DROP_CONTACT_EMAIL}</a>. Sign-in magic links still come from{' '}
          {ELIXIR_DROP_MAGIC_LINK_FROM_EMAIL}.
        </p>
      </MetaSection>
      <MetaSection title="Fan content" muted>
        <p>{ABOUT.disclaimer}</p>
        <p>{ABOUT.policyNotice}</p>
      </MetaSection>
    </div>
  )
}

function FaqBody() {
  return (
    <div class="ed-meta-sections">
      {FAQ.items.map((item) => (
        <MetaSection title={item.q} key={item.q}>
          <p>{item.a}</p>
        </MetaSection>
      ))}
    </div>
  )
}

function StepCard({ label, steps }: { label: string; steps: string[] }) {
  return (
    <div class="ed-install-steps">
      <div class="ed-install-steps__label">{label}</div>
      <ol class="ed-install-steps__list">
        {steps.map((step, i) => (
          <li class="ed-install-steps__step" key={step}>
            <span class="ed-install-steps__n">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function InstallBody() {
  return (
    <div class="ed-page__prose">
      <p>{INSTALL.intro}</p>
      <StepCard label={INSTALL.ios.label} steps={INSTALL.ios.steps} />
      <StepCard label={INSTALL.android.label} steps={INSTALL.android.steps} />
    </div>
  )
}

const CONTENT = { about: ABOUT, releases: RELEASES, faq: FAQ, install: INSTALL }

export default function MetaPage({ kind }: { kind: MetaPageKind }) {
  const meta = CONTENT[kind]
  return (
    <article class="ed-page">
      <MetaPageHead eyebrow={meta.eyebrow} title={meta.title} />
      {kind === 'about' && <AboutBody />}
      {kind === 'releases' && <ReleaseList entries={releases} />}
      {kind === 'faq' && <FaqBody />}
      {kind === 'install' && <InstallBody />}
    </article>
  )
}
