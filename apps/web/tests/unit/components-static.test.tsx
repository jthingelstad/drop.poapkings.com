import { describe, it, expect, afterEach } from 'vitest'
import { renderToStringAsync } from 'preact-render-to-string'

import Summary from '../../src/components/Summary'
import MetaPage from '../../src/screens/MetaPage'
import Privacy from '../../src/screens/Privacy'
import MetaMoreList from '../../src/components/MetaMoreList'
import { InstallBanner, InstallRow } from '../../src/components/InstallPrompt'
import { ElixirCostBadge, CardName, CardArt } from '../../src/components/CardChrome'
import CardDisplay from '../../src/components/CardDisplay'
import SignInToSave from '../../src/components/SignInToSave'
import ShareLine from '../../src/components/ShareLine'
import GameRunGate from '../../src/components/GameRunGate'
import RunCountdown from '../../src/components/RunCountdown'
import MultipleChoice from '../../src/components/MultipleChoice'
import PenaltyFlash from '../../src/components/PenaltyFlash'
import PlayerAvatar from '../../src/components/PlayerAvatar'
import ApiStatusBanner from '../../src/components/ApiStatusBanner'
import RunRecordingNotice from '../../src/components/RunRecordingNotice'

import { player } from '../../src/lib/account'
import { installMode, installEligible, installDismissed } from '../../src/lib/pwa-install'
import { apiAvailability, apiUnavailableReason } from '../../src/lib/api-availability'
import { recordingNotice } from '../../src/lib/use-game-run'
import { ABOUT, FAQ, INSTALL } from '../../src/data/meta-content'
import { ELIXIR_DROP_DISCORD_URL } from '../../src/lib/links'
import type { Insights } from '../../src/lib/insights'
import type { Card } from '../../src/types'

const render = (node: Parameters<typeof renderToStringAsync>[0]) => renderToStringAsync(node)

// Real catalog card (Knight) with a local icon — safe for static render.
const KNIGHT: Card = {
  id: 26000000,
  name: 'Knight',
  elixir: 3,
  rarity: 'common',
  type: 'troop',
  evo: true,
  hero: true,
  icon: '/cards/26000000.png'
}
const GIANT: Card = {
  id: 26000003,
  name: 'Giant',
  elixir: 5,
  rarity: 'rare',
  type: 'troop',
  evo: false,
  hero: false,
  icon: '/cards/26000003.png'
}
const NO_ICON: Card = { ...KNIGHT, id: 99999999, name: 'Ghost', icon: '' }

function emptyInsights(over: Partial<Insights> = {}): Insights {
  return {
    total: 0,
    correct: 0,
    accuracyPct: 0,
    bands: [
      { label: '1–2', correct: 0, total: 0 },
      { label: '3', correct: 0, total: 0 },
      { label: '4', correct: 0, total: 0 },
      { label: '5', correct: 0, total: 0 },
      { label: '6+', correct: 0, total: 0 }
    ],
    weakest: [],
    hasTiming: false,
    ...over
  }
}

afterEach(() => {
  player.value = null
  installMode.value = 'none'
  installEligible.value = false
  installDismissed.value = false
  apiAvailability.value = 'checking'
  apiUnavailableReason.value = 'service'
  recordingNotice.value = { state: 'idle' }
})

describe('Summary', () => {
  it('renders eyebrow, headline and PB callout with star icon', async () => {
    player.value = { id: 'p1' } as never // signed-in: SignInToSave collapses
    const html = await render(
      <Summary
        eyebrow="Surge complete"
        headline="28.6s"
        pbCallout="New personal best! −3.4s"
        insights={emptyInsights({ accuracyPct: 95 })}
        onReplay={() => {}}
        onHome={() => {}}
      />
    )
    expect(html).toContain('ed-eyebrow')
    expect(html).toContain('Surge complete')
    expect(html).toContain('28.6s')
    // pbCallout renders the ed-sum__pb block and a default gold "Moment" tile.
    expect(html).toContain('ed-sum__pb')
    expect(html).toContain('New personal best! −3.4s')
    expect(html).toContain('ed-sum-tile--gold')
    // Default replay label + Home button.
    expect(html).toContain('Play again')
    expect(html).toContain('Home')
    // Signed in → no sign-in-to-save panel.
    expect(html).not.toContain('signin-save')
  })

  it('shows the guest SignInToSave panel when signed out', async () => {
    player.value = null
    const html = await render(
      <Summary
        eyebrow="Practice round"
        headline="12 / 15"
        insights={emptyInsights()}
        onReplay={() => {}}
        onHome={() => {}}
      />
    )
    expect(html).toContain('signin-save')
    expect(html).toContain('Sign in to save')
    // No pbCallout → no pb block.
    expect(html).not.toContain('ed-sum__pb')
  })

  it('derives a "Clean read" green moment for high accuracy without a PB', async () => {
    const html = await render(
      <Summary
        eyebrow="e"
        headline="h"
        insights={emptyInsights({ total: 10, correct: 10, accuracyPct: 100 })}
        onReplay={() => {}}
        onHome={() => {}}
      />
    )
    expect(html).toContain('Clean read')
    expect(html).toContain('ed-sum-tile--green')
  })

  it('derives a "first try" purple moment for mid accuracy', async () => {
    const html = await render(
      <Summary
        eyebrow="e"
        headline="h"
        insights={emptyInsights({ total: 15, correct: 9, accuracyPct: 60 })}
        onReplay={() => {}}
        onHome={() => {}}
      />
    )
    expect(html).toContain('9/15 first try')
    expect(html).toContain('ed-sum-tile--purple')
  })

  it('renders bands, missed chips, slowest reads, custom moments, replay label and children', async () => {
    const insights = emptyInsights({
      total: 4,
      correct: 2,
      accuracyPct: 50,
      bands: [
        { label: '1–2', correct: 1, total: 1 },
        { label: '3', correct: 1, total: 2 },
        { label: '4', correct: 0, total: 0 },
        { label: '5', correct: 0, total: 1 },
        { label: '6+', correct: 0, total: 0 }
      ],
      weakest: [KNIGHT, GIANT],
      hasTiming: true,
      slowestCards: [GIANT]
    })
    const html = await render(
      <Summary
        eyebrow="Surge"
        headline="40s"
        insights={insights}
        moments={[{ label: 'Custom', value: 'Nice', tone: 'green' }]}
        replayLabel="Run it back"
        onReplay={() => {}}
        onHome={() => {}}
      >
        <div class="my-share-slot">shared</div>
      </Summary>
    )
    // Custom moment overrides defaults.
    expect(html).toContain('Custom')
    expect(html).toContain('Nice')
    // hasBands → accuracy-by-cost section.
    expect(html).toContain('Accuracy by cost')
    expect(html).toContain('ed-sum-band__fill')
    expect(html).toContain('height:100%')
    expect(html).toContain('height:50%')
    // weakest chips.
    expect(html).toContain('Missed this round')
    expect(html).toContain('Knight')
    expect(html).toContain('Giant')
    // slowest reads (timing).
    expect(html).toContain('Slowest reads')
    // children slot.
    expect(html).toContain('my-share-slot')
    // custom replay label.
    expect(html).toContain('Run it back')
  })
})

describe('MetaPage', () => {
  it('renders the About page copy with a back button', async () => {
    const html = await render(<MetaPage kind="about" />)
    expect(html).toContain('ed-page__back')
    expect(html).toContain('aria-label="Back"')
    expect(html).toContain(ABOUT.title)
    expect(html).toContain(ABOUT.eyebrow)
    expect(html).toContain('ed-meta-sections')
    expect(html).toContain('ed-meta-section--muted')
    expect(html).toContain(ABOUT.sections[0]!.title)
    expect(html).toContain(ABOUT.sections[0]!.body)
    // FAQ / install specific markup absent.
    expect(html).not.toContain('ed-install-steps')
  })

  it('renders the FAQ page with question/answer items', async () => {
    const html = await render(<MetaPage kind="faq" />)
    expect(html).toContain(FAQ.title)
    expect(html).toContain('ed-meta-section')
    expect(html).toContain(FAQ.items[0].q)
    expect(html).toContain(FAQ.items[0].a)
  })

  it('renders Privacy with the shared header and section-card treatment', async () => {
    const html = await render(<Privacy />)
    expect(html).toContain('ed-page ed-page--privacy')
    expect(html).toContain('ed-page__back')
    expect(html).toContain('ed-meta-sections')
    expect(html).toContain('ed-meta-section')
    expect(html).toContain('What Drop keeps—and why')
    expect(html).toContain('Retention and deletion')
    expect(html).not.toContain('main-content privacy-screen')
  })

  it('renders the Install page with numbered iOS and Android steps', async () => {
    const html = await render(<MetaPage kind="install" />)
    expect(html).toContain(INSTALL.title)
    expect(html).toContain('ed-install-steps')
    expect(html).toContain(INSTALL.ios.label)
    expect(html).toContain(INSTALL.android.label)
    expect(html).toContain(INSTALL.ios.steps[0])
    expect(html).toContain(INSTALL.intro)
  })
})

describe('MetaMoreList', () => {
  it('renders internal button rows and an external Discord anchor', async () => {
    const html = await render(<MetaMoreList />)
    expect(html).toContain('About')
    expect(html).toContain('FAQ')
    expect(html).toContain('Install app')
    expect(html).toContain('Privacy')
    expect(html).toContain('Discord')
    // Discord is the only external anchor with the real href + new-tab rel.
    expect(html).toContain(`href="${ELIXIR_DROP_DISCORD_URL}"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    // Non-external rows are buttons.
    expect(html).toContain('<button')
  })
})

describe('InstallPrompt', () => {
  it('InstallBanner is hidden when install is not available', async () => {
    installMode.value = 'none'
    installDismissed.value = false
    expect(await render(<InstallBanner />)).toBe('')
  })

  it('InstallBanner stays hidden before the third-session eligibility threshold', async () => {
    installMode.value = 'available'
    installEligible.value = false
    installDismissed.value = false
    expect(await render(<InstallBanner />)).toBe('')
  })

  it('InstallBanner shows when available and not dismissed', async () => {
    installMode.value = 'available'
    installEligible.value = true
    installDismissed.value = false
    const html = await render(<InstallBanner />)
    expect(html).toContain('ed-installbar')
    expect(html).toContain('Install for full-screen play')
    expect(html).toContain('aria-label="Dismiss"')
  })

  it('InstallBanner hides once dismissed', async () => {
    installMode.value = 'available'
    installEligible.value = true
    installDismissed.value = true
    expect(await render(<InstallBanner />)).toBe('')
  })

  it('InstallRow only shows after dismissal when installable', async () => {
    installMode.value = 'ios'
    installEligible.value = true
    installDismissed.value = false
    expect(await render(<InstallRow />)).toBe('')

    installDismissed.value = true
    const html = await render(<InstallRow />)
    expect(html).toContain('ed-installrow')
    expect(html).toContain('Install for full-screen play')

    installMode.value = 'none'
    expect(await render(<InstallRow />)).toBe('')
  })
})

describe('CardChrome', () => {
  it('ElixirCostBadge renders default and wrong tones with aria-label', async () => {
    const def = await render(<ElixirCostBadge elixir={4} />)
    expect(def).toContain('cr-elixir-badge')
    expect(def).toContain('aria-label="4 elixir"')
    expect(def).not.toContain('cr-elixir-badge--wrong')

    const wrong = await render(<ElixirCostBadge elixir={7} tone="wrong" className="x" />)
    expect(wrong).toContain('cr-elixir-badge--wrong')
    expect(wrong).toContain('aria-label="7 elixir"')
    expect(wrong).toContain('x')
  })

  it('CardName applies a rarity tone class and shows the name', async () => {
    const common = await render(<CardName card={KNIGHT} />)
    expect(common).toContain('cr-card-name--common')
    expect(common).toContain('Knight')

    const rare = await render(<CardName card={GIANT} className="chip" />)
    expect(rare).toContain('cr-card-name--rare')
    expect(rare).toContain('chip')
  })

  it('CardArt renders the image, optional cost and name', async () => {
    const html = await render(
      <CardArt card={KNIGHT} className="a" imgClassName="b" fallbackClassName="c" showCost showName alt="Knight" />
    )
    expect(html).toContain('cr-card-art')
    expect(html).toContain('src="/cards/26000000.png"')
    expect(html).toContain('cr-elixir-badge') // showCost
    expect(html).toContain('cr-card-name') // showName
    expect(html).not.toContain('cr-card-art__fallback')
  })

  it('CardArt falls back to a placeholder when the card has no icon', async () => {
    const html = await render(<CardArt card={NO_ICON} className="a" imgClassName="b" fallbackClassName="c" />)
    expect(html).toContain('cr-card-art__fallback')
    expect(html).not.toContain('<img')
  })
})

describe('CardDisplay', () => {
  it('hides the cost while playing', async () => {
    const html = await render(<CardDisplay card={KNIGHT} phase="playing" />)
    expect(html).toContain('pcard')
    expect(html).not.toContain('cr-elixir-badge')
    expect(html).not.toContain('drop-pop-wrap')
    expect(html).toContain('Knight') // name shown by default
  })

  it('reveals the cost without the retired purple drop on a correct answer', async () => {
    const html = await render(<CardDisplay card={KNIGHT} phase="correct" />)
    expect(html).toContain('pcard--correct')
    expect(html).toContain('cr-elixir-badge')
    expect(html).not.toContain('drop-pop-wrap')
  })

  it('keeps the cost hidden on a wrong Surge answer (revealCost false)', async () => {
    const html = await render(<CardDisplay card={KNIGHT} phase="wrong" revealCost={false} />)
    expect(html).toContain('pcard--wrong')
    expect(html).not.toContain('cr-elixir-badge')
  })

  it('forceReveal shows the cost even while playing, and hideName drops the name', async () => {
    const html = await render(<CardDisplay card={KNIGHT} phase="playing" forceReveal hideName />)
    expect(html).toContain('cr-elixir-badge')
    expect(html).not.toContain('cr-card-name')
  })
})

describe('SignInToSave', () => {
  it('renders nothing when signed in', async () => {
    player.value = { id: 'x' } as never
    expect(await render(<SignInToSave />)).toBe('')
  })

  it('renders the full panel variant for guests', async () => {
    player.value = null
    const html = await render(<SignInToSave />)
    expect(html).toContain('competition-panel--join')
    expect(html).toContain('Create an account to save this score')
    expect(html).toContain('Sign in to save')
  })

  it('renders the compact line variant', async () => {
    player.value = null
    const html = await render(<SignInToSave variant="line" />)
    expect(html).toContain('signin-save--line')
    expect(html).toContain('Sign in to save your streak')
  })
})

describe('ShareLine', () => {
  it('renders a read-only share input and a Copy button', async () => {
    const html = await render(<ShareLine mode="surge" text="I read 15 cards in 28.6s" />)
    expect(html).toContain('shareline')
    expect(html).toContain('Share your time')
    expect(html).toContain('value="I read 15 cards in 28.6s"')
    expect(html).toContain('readonly')
    expect(html).toContain('Copy')
  })
})

describe('GameRunGate', () => {
  it('shows the preparing state', async () => {
    const html = await render(<GameRunGate preparing error="" onRetry={() => {}} />)
    expect(html).toContain('Preparing your game')
    expect(html).toContain('signed run')
    expect(html).not.toContain('Try again')
  })

  it('shows the error state with a retry button and the given message', async () => {
    const html = await render(<GameRunGate preparing={false} error="Boom happened" onRetry={() => {}} />)
    expect(html).toContain('This game could not start')
    expect(html).toContain('Boom happened')
    expect(html).toContain('Try again')
  })

  it('falls back to a default error message when none is given', async () => {
    const html = await render(<GameRunGate preparing={false} error="" onRetry={() => {}} />)
    expect(html).toContain('Player services are temporarily unavailable')
  })
})

describe('RunCountdown', () => {
  it('renders the count and an accessible starting label', async () => {
    const html = await render(<RunCountdown count={3} />)
    expect(html).toContain('run-count')
    expect(html).toContain('aria-label="Starting in 3"')
    expect(html).toContain('>3<')
  })
})

describe('MultipleChoice', () => {
  it('renders a button per choice with aria-labels', async () => {
    const html = await render(<MultipleChoice choices={[3, 4, 5, 6]} onPick={() => {}} />)
    expect(html).toContain('mc-choices')
    expect(html).toContain('aria-label="3 elixir"')
    expect(html).toContain('aria-label="6 elixir"')
    expect(html).not.toContain('disabled')
  })

  it('disables the buttons when disabled', async () => {
    const html = await render(<MultipleChoice choices={[2, 3]} onPick={() => {}} disabled />)
    expect(html).toContain('disabled')
  })
})

describe('PenaltyFlash', () => {
  it('reserves space but shows no chip when pulse is 0', async () => {
    const html = await render(<PenaltyFlash pulse={0} label="+2.0s" />)
    expect(html).toContain('penalty-flash')
    expect(html).not.toContain('penalty-flash__chip')
    expect(html).not.toContain('+2.0s')
  })

  it('shows the penalty chip once the pulse fires', async () => {
    const html = await render(<PenaltyFlash pulse={1} label="+2.0s" />)
    expect(html).toContain('penalty-flash__chip')
    expect(html).toContain('+2.0s')
  })
})

describe('PlayerAvatar', () => {
  it('renders the default fallback avatar with no favorite card', async () => {
    const html = await render(<PlayerAvatar />)
    expect(html).toContain('player-avatar--fallback')
    expect(html).toContain('player-avatar--medium')
    expect(html).toContain('/assets/emoji/elixir.png')
    expect(html).toContain('alt="Elixir Drop player"')
  })

  it('renders a favorite-card avatar with crop vars and size class', async () => {
    const html = await render(<PlayerAvatar favoriteCardId={KNIGHT.id} size="large" class="nav-av" />)
    expect(html).toContain('player-avatar--large')
    expect(html).toContain('nav-av')
    expect(html).not.toContain('player-avatar--fallback')
    expect(html).toContain('src="/cards/26000000.png"')
    expect(html).toContain('Knight favorite card')
    expect(html).toContain('--avatar-x')
  })

  it('falls back when the favorite card id is not in the catalog', async () => {
    const html = await render(<PlayerAvatar favoriteCardId={123} />)
    expect(html).toContain('player-avatar--fallback')
    expect(html).toContain('/assets/emoji/elixir.png')
  })
})

describe('ApiStatusBanner', () => {
  it('renders nothing while the API is available', async () => {
    apiAvailability.value = 'available'
    expect(await render(<ApiStatusBanner />)).toBe('')
  })

  it('shows the offline copy', async () => {
    apiAvailability.value = 'unavailable'
    apiUnavailableReason.value = 'offline'
    const html = await render(<ApiStatusBanner />)
    expect(html).toContain('api-status')
    expect(html).toContain('reach the internet')
    expect(html).toContain('Try reconnecting')
  })

  it('shows the service-break copy', async () => {
    apiAvailability.value = 'unavailable'
    apiUnavailableReason.value = 'service'
    const html = await render(<ApiStatusBanner />)
    expect(html).toContain('elixir break')
    expect(html).toContain('Player services are unavailable')
  })
})

describe('RunRecordingNotice', () => {
  it('renders nothing when idle', async () => {
    recordingNotice.value = { state: 'idle' }
    expect(await render(<RunRecordingNotice />)).toBe('')
  })

  it('shows a non-blocking saved notice', async () => {
    recordingNotice.value = { state: 'saved', message: 'Score saved' }
    const html = await render(<RunRecordingNotice />)
    expect(html).toContain('run-recording__card--saved')
    expect(html).toContain('Score saved')
    expect(html).not.toContain('run-recording--blocking')
  })

  it('shows a blocking saving notice with a spinner', async () => {
    recordingNotice.value = { state: 'saving', message: 'Saving your run…' }
    const html = await render(<RunRecordingNotice />)
    expect(html).toContain('run-recording--blocking')
    expect(html).toContain('run-recording__card--saving')
    expect(html).toContain('Saving your run…')
  })

  it('shows an error notice with detail and a retry action', async () => {
    recordingNotice.value = {
      state: 'error',
      message: 'Could not save',
      detail: 'Network failed',
      actionLabel: 'Retry save',
      action: () => {}
    }
    const html = await render(<RunRecordingNotice />)
    expect(html).toContain('run-recording--blocking')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Could not save')
    expect(html).toContain('Network failed')
    expect(html).toContain('Retry save')
  })
})
