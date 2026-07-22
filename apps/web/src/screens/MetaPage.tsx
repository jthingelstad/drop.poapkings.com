// Static meta pages (About / FAQ / Install), rendered from the single content
// module (data/meta-content.ts). Same component on both shells: mobile shows it
// as a full sub-screen with a back arrow; desktop renders it in the center
// stage. No game, auth, or leaderboard logic here.

import MetaPageHead from '../components/MetaPageHead'
import MetaSection from '../components/MetaSection'
import { ABOUT, FAQ, INSTALL } from '../data/meta-content'

export type MetaPageKind = 'about' | 'faq' | 'install'

function AboutBody() {
  return (
    <div class="ed-meta-sections">
      {ABOUT.sections.map((section) => (
        <MetaSection title={section.title} key={section.title}>
          <p>{section.body}</p>
        </MetaSection>
      ))}
      <MetaSection title="Fan content" muted>
        <p>{ABOUT.disclaimer}</p>
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

export default function MetaPage({ kind }: { kind: MetaPageKind }) {
  const meta = kind === 'about' ? ABOUT : kind === 'faq' ? FAQ : INSTALL
  return (
    <article class="ed-page">
      <MetaPageHead eyebrow={meta.eyebrow} title={meta.title} />
      {kind === 'about' && <AboutBody />}
      {kind === 'faq' && <FaqBody />}
      {kind === 'install' && <InstallBody />}
    </article>
  )
}
