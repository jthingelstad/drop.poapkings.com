// Static meta pages (About / FAQ / Install), rendered from the single content
// module (data/meta-content.ts). Same component on both shells: mobile shows it
// as a full sub-screen with a back arrow; desktop renders it in the center
// stage. No game, auth, or leaderboard logic here.

import { back } from '../lib/router'
import Icon from '../components/Icon'
import { ABOUT, FAQ, INSTALL } from '../data/meta-content'

export type MetaPageKind = 'about' | 'faq' | 'install'

function PageHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div class="ed-page__head">
      <button class="ed-page__back tap-fx" onClick={() => back('/')} aria-label="Back">
        <Icon name="chevron-left" />
      </button>
      <div>
        <div class="ed-page__eyebrow">{eyebrow}</div>
        <h1 class="ed-page__title">{title}</h1>
      </div>
    </div>
  )
}

function AboutBody() {
  return (
    <div class="ed-page__prose">
      {ABOUT.paras.map((p) => (
        <p key={p}>{p}</p>
      ))}
      <p class="ed-page__disclaimer">{ABOUT.disclaimer}</p>
    </div>
  )
}

function FaqBody() {
  return (
    <div class="ed-faq">
      {FAQ.items.map((item) => (
        <div class="ed-faq__item" key={item.q}>
          <div class="ed-faq__q">{item.q}</div>
          <p class="ed-faq__a">{item.a}</p>
        </div>
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
    <div class="ed-page">
      <PageHead eyebrow={meta.eyebrow} title={meta.title} />
      {kind === 'about' && <AboutBody />}
      {kind === 'faq' && <FaqBody />}
      {kind === 'install' && <InstallBody />}
    </div>
  )
}
