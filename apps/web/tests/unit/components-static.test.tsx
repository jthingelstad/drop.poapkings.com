import { describe, it, expect, afterEach } from 'vitest'
import { renderToStringAsync } from 'preact-render-to-string'
import { signal } from '@preact/signals'

import Summary from '../../src/components/Summary'
import AppInfo from '../../src/screens/AppInfo'
import { InstallBanner, InstallRow } from '../../src/components/InstallPrompt'
import { ElixirCostBadge, CardName, CardArt } from '../../src/components/CardChrome'
import CardDisplay from '../../src/components/CardDisplay'
import SignInToSave from '../../src/components/SignInToSave'
import ShareLine from '../../src/components/ShareLine'
import GameRunGate from '../../src/components/GameRunGate'
import GameStartScreen from '../../src/components/game/GameStart'
import RunCountdown from '../../src/components/RunCountdown'
import MultipleChoice from '../../src/components/MultipleChoice'
import PenaltyFlash from '../../src/components/PenaltyFlash'
import PlayerAvatar from '../../src/components/PlayerAvatar'
import RunRecordingNotice from '../../src/components/RunRecordingNotice'

import { player } from '../../src/lib/account'
import { installMode, installEligible, installDismissed, standaloneApp } from '../../src/lib/pwa-install'
import { earnedXp, recordedRunId, recordingNotice } from '../../src/lib/use-game-run'
import { renderStaticPage, STATIC_PAGE_SLUGS } from '../../scripts/static-pages'
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
  standaloneApp.value = false
  recordingNotice.value = { state: 'idle' }
  earnedXp.value = 0
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
        share={{ mode: 'surge', score: '28.6s' }}
        onReplay={() => {}}
        onHome={() => {}}
      />
    )
    expect(html).toContain('ed-eyebrow')
    expect(html).toContain('Surge complete')
    expect(html).toContain('28.6s')
    // The PB callout reads back in the "what it changed" ledger block.
    expect(html).toContain('ed-sum__changed')
    expect(html).toContain('New personal best! −3.4s')
    // Default replay label + Home button.
    expect(html).toContain('Play again')
    expect(html).toContain('Home')
    // Signed in → no sign-in-to-save panel.
    expect(html).not.toContain('signin-save')
    // The generic moment tiles are gone.
    expect(html).not.toContain('ed-sum-tile')
  })

  it('reads XP earned back in the "what it changed" ledger', async () => {
    player.value = { id: 'p1' } as never
    earnedXp.value = 15
    const html = await render(
      <Summary
        eyebrow="Surge complete"
        headline="28.6s"
        insights={emptyInsights()}
        share={{ mode: 'surge', score: '28.6s' }}
        onReplay={() => {}}
        onHome={() => {}}
      />
    )
    expect(html).toContain('ed-sum__changed')
    expect(html).toContain('XP earned')
    expect(html).toContain('+15')
  })

  it('does not invite a guest to save an intentionally unranked Practice session', async () => {
    player.value = null
    const html = await render(
      <Summary
        eyebrow="Practice round"
        headline="12 / 15"
        insights={emptyInsights()}
        share={{ mode: 'practice', score: '80% accuracy' }}
        onReplay={() => {}}
        onHome={() => {}}
      />
    )
    expect(html).not.toContain('signin-save')
    expect(html).not.toContain('Sign in to save')
    expect(html).not.toContain('shareline')
    expect(html).not.toContain('Share score')
    // No pbCallout → no pb block.
    expect(html).not.toContain('ed-sum__pb')
  })

  it('merges missed and slow cards into one "Work on these" list and renders the signature slot', async () => {
    const insights = emptyInsights({
      total: 4,
      correct: 2,
      accuracyPct: 50,
      weakest: [KNIGHT, GIANT],
      hasTiming: true,
      slowestCards: [GIANT]
    })
    const html = await render(
      <Summary
        eyebrow="Surge"
        headline="40s"
        insights={insights}
        share={{ mode: 'surge', score: '40s' }}
        replayLabel="Run it back"
        onReplay={() => {}}
        onHome={() => {}}
      >
        <div class="my-share-slot">signature</div>
      </Summary>
    )
    // The two old taxonomies (Missed / Slowest) merge into one list, deduped.
    expect(html).toContain('Work on these')
    expect(html).toContain('Knight')
    expect(html).toContain('Giant')
    expect(html).not.toContain('Missed this round')
    expect(html).not.toContain('Slowest reads')
    // The accuracy-by-cost chart and the generic tiles are gone.
    expect(html).not.toContain('Accuracy by cost')
    expect(html).not.toContain('ed-sum-tile')
    // The mode's signature panel (children) renders.
    expect(html).toContain('my-share-slot')
    expect(html).toContain('Run it back')
  })

  // A not-recorded run has no share control at all: offline and guest runs have
  // no server record, so no permalink can exist. Absent, not disabled — a
  // disabled button invites a tap and then has to explain itself.
  it('offers the share control only for a run the server actually recorded', async () => {
    const props = {
      eyebrow: 'Surge',
      headline: '40s',
      insights: emptyInsights({ total: 1, correct: 1, accuracyPct: 100 }),
      share: { mode: 'surge' as const, score: '40s' },
      onReplay: () => {},
      onHome: () => {}
    }

    recordedRunId.value = null
    const unrecorded = await render(<Summary {...props} />)
    expect(unrecorded).not.toContain('shareline')
    expect(unrecorded).not.toContain('Share this run')

    recordedRunId.value = 'run-42'
    const recorded = await render(<Summary {...props} />)
    expect(recorded).toContain('shareline')
    expect(recorded).toContain('Share this run')
    recordedRunId.value = null
  })
})

describe('standalone pages', () => {
  it('renders every page as a complete canonical HTML document', () => {
    for (const slug of STATIC_PAGE_SLUGS) {
      const html = renderStaticPage(slug)
      expect(html).toContain('<!doctype html>')
      expect(html).toContain(`<link rel="canonical" href="https://drop.poapkings.com/${slug}/">`)
      expect(html).toContain('<h1>')
      expect(html).toContain('static-sections')
      expect(html).toContain('Run by')
      expect(html).toContain('Play Elixir Drop')
    }
  })

  it('keeps discovery, support, policy, and setup copy in real HTML', () => {
    expect(renderStaticPage('games')).toContain('Compare Elixir Drop game modes')
    expect(renderStaticPage('learn-elixir-costs')).toContain('Recall before recognition')
    expect(renderStaticPage('elixir-costs')).toContain('Three Musketeers')
    const badges = renderStaticPage('badges')
    expect(badges).toContain('Clockbreaker')
    expect(badges).toContain('7 hidden badges')
    expect(badges).not.toContain('Night Shift')
    expect(renderStaticPage('discord')).toContain('You do not need to be a POAP KINGS clan member')
    expect(renderStaticPage('about')).toContain('mailto:drop@poapkings.com')
    expect(renderStaticPage('faq')).toContain('What counts for the leaderboards?')
    const fairPlay = renderStaticPage('fair-play')
    expect(fairPlay).toContain('Awaiting')
    expect(fairPlay).toContain('Cleared')
    expect(fairPlay).toContain('Excluded')
    expect(fairPlay).toContain('Practice remains available')
    expect(fairPlay).toContain('Elixir%20Drop%20Fair%20Play%20re-review')
    expect(renderStaticPage('privacy')).toContain('Retention and deletion')
    expect(renderStaticPage('releases')).toContain('Principled P.E.K.K.A')
    expect(renderStaticPage('install')).toContain('Add to Home Screen')
    expect(renderStaticPage('install')).toContain('never uploaded later')
  })
})

describe('AppInfo', () => {
  it('renders build and card-library diagnostics before the browser status resolves', async () => {
    standaloneApp.value = true
    const html = await render(<AppInfo />)

    expect(html).toContain('App Info')
    expect(html).toContain('Installed app')
    expect(html).toContain('Build ID')
    expect(html).toContain('Build date')
    expect(html).toContain('Player API')
    expect(html).toContain('API endpoint')
    expect(html).toContain('API latency')
    expect(html).toContain('Card catalog')
    expect(html).toContain('Service worker')
    expect(html).toContain('Card cache')
    expect(html).toContain('Card art')
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

  it('CardArt renders the image behind a decode-time fallback, plus optional cost and name', async () => {
    const html = await render(
      <CardArt card={KNIGHT} className="a" imgClassName="b" fallbackClassName="c" showCost showName alt="Knight" />
    )
    expect(html).toContain('cr-card-art')
    expect(html).toContain('src="/cards/26000000.png"')
    expect(html).toContain('cr-elixir-badge') // showCost
    expect(html).toContain('cr-card-name') // showName
    expect(html).toContain('cr-card-art__fallback')
    expect(html).toContain('cr-card-art__img--loading')
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

  it('renders the shared gate card for guests', async () => {
    player.value = null
    const html = await render(<SignInToSave />)
    expect(html).toContain('ed-gate')
    expect(html).toContain('Guest run')
    expect(html).toContain('Sign in before your next game to save future scores')
    expect(html).toContain('Sign in')
  })

  it('renders the compact line variant', async () => {
    player.value = null
    const html = await render(<SignInToSave variant="line" />)
    expect(html).toContain('signin-save--line')
    expect(html).toContain('Sign in before your next game to save future scores')
  })
})

describe('ShareLine', () => {
  it('renders a share action against the run it will mint a token for', async () => {
    const html = await render(<ShareLine mode="surge" score="28.60s" runId="run-1" />)
    expect(html).toContain('shareline')
    expect(html).toContain('Share your score')
    expect(html).toContain('Surge · 28.60s')
    expect(html).toContain('Share this run')
    // The unbundled copy/save path is the no-native-sheet branch, not a
    // permanently visible second control.
    expect(html).not.toContain('shareline__unbundled')
  })
})

describe('GameRunGate', () => {
  // The gate reads the session a mode hands it — the same shape all six modes
  // used to unpack into three separate props.
  function gateSession(preparing: boolean, error: string) {
    return { preparing: signal(preparing), error, prepare: async () => {} }
  }

  it('shows the preparing state', async () => {
    const html = await render(<GameRunGate modeName="Surge" session={gateSession(true, '')} />)
    expect(html).toContain('data-game-start-phase="preparing"')
    // The preparing/loading slot is the charge ring now, in the same 172px gold
    // slot the countdown numeral lands in. Copy is "Charging" — no mode name.
    expect(html).toContain('charge-ring')
    expect(html).toContain('>Charging<')
    expect(html).toContain('>Surge<')
    expect(html).not.toContain('Try again')
  })

  it('shows the error state with a retry button and the given message', async () => {
    const html = await render(<GameRunGate modeName="Surge" session={gateSession(false, 'Boom happened')} />)
    expect(html).toContain('This game could not start')
    expect(html).toContain('Boom happened')
    expect(html).toContain('Try again')
    expect(html).not.toContain('route-loading__spinner')
  })

  it('falls back to a default error message when none is given', async () => {
    const html = await render(<GameRunGate modeName="Surge" session={gateSession(false, '')} />)
    expect(html).toContain('Player services are temporarily unavailable')
  })
})

describe('GameStartScreen', () => {
  it('renders asset loading in the same game and countdown shell', async () => {
    const html = await render(<GameStartScreen modeName="Trade" phase="loading" />)
    expect(html).toContain('class="ed-game ed-game--starting"')
    expect(html).toContain('data-game-start-phase="loading"')
    expect(html).toContain('ed-game__count-num--status')
    expect(html).toContain('charge-ring')
    expect(html).toContain('>Charging<')
    expect(html).toContain('>Trade<')
  })
})

describe('RunCountdown', () => {
  it('renders the count and an accessible starting label', async () => {
    const html = await render(<RunCountdown count={3} />)
    expect(html).toContain('run-count')
    expect(html).toContain('aria-label="Starting in 3"')
    expect(html).toContain('>3<')
    expect(html).not.toContain('<img')
    // The charge ring is the separate loading state (Commit 4), not the countdown.
    expect(html).not.toContain('run-count__ring')
  })

  it('renders the final GO beat instead of zero', async () => {
    const html = await render(<RunCountdown count={0} />)
    expect(html).toContain('aria-label="Go"')
    expect(html).toContain('>GO<')
    expect(html).not.toContain('<img')
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
    expect(html).toContain('/assets/icon/drop-icon-192.png')
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
    expect(html).toContain('/assets/icon/drop-icon-192.png')
  })
})

describe('RunRecordingNotice', () => {
  it('renders nothing when idle', async () => {
    recordingNotice.value = { state: 'idle' }
    expect(await render(<RunRecordingNotice />)).toBe('')
  })

  it('shows a non-blocking saved notice', async () => {
    recordingNotice.value = { state: 'saved', message: 'Score saved', detail: 'Reference: run-1' }
    const html = await render(<RunRecordingNotice />)
    expect(html).toContain('run-recording__card--saved')
    expect(html).toContain('Score saved')
    expect(html).toContain('Reference: run-1')
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
