// Single source of truth for the static meta pages (About / FAQ / Install),
// read by both the mobile and desktop shells. Mirrors the design's
// `meta-content.js` → `window.DROP_META`, but as a typed module. Privacy keeps
// its own richer screen (screens/Privacy.tsx) with the real, sectioned copy.
// Discord is an external link — see ELIXIR_DROP_DISCORD_URL in lib/links.ts.

export interface FaqItem {
  q: string
  a: string
}

export interface InstallStepList {
  label: string
  steps: string[]
}

export interface AboutContent {
  eyebrow: string
  title: string
  paras: string[]
  // Relocated from the old global footer — the required fan-content notice.
  disclaimer: string
}

export interface FaqContent {
  eyebrow: string
  title: string
  items: FaqItem[]
}

export interface InstallContent {
  eyebrow: string
  title: string
  intro: string
  ios: InstallStepList
  android: InstallStepList
}

export const ABOUT: AboutContent = {
  eyebrow: 'What is this',
  title: 'About Elixir Drop',
  paras: [
    'Elixir Drop is a reflex trainer built by the POAP KINGS. It turns one small Clash Royale skill — knowing every card’s elixir cost cold — into a fast, replayable game.',
    'Six modes push that instinct in different ways: Surge races the clock, Higher / Lower and Trade test comparison, Survival is sudden death, Rain drops cards you clear before they land, and Practice stays unranked so you can warm up without the pressure.',
    'Every ranked run is scored and stacked against the seasonal leaderboards. It’s free, it runs in your browser, and it plays best installed to your home screen.'
  ],
  disclaimer:
    'This fan community is not affiliated with Supercell. Clash Royale is a trademark of its respective owner. Card data and artwork © Supercell, used under Supercell’s Fan Content Policy.'
}

export const FAQ: FaqContent = {
  eyebrow: 'Good to know',
  title: 'Frequently asked',
  items: [
    {
      q: 'Do I need an account?',
      a: 'No — you can play every mode as a guest. Signing in with your email saves your scores, levels, and leaderboard spot across devices.'
    },
    {
      q: 'How does sign-in work?',
      a: 'There’s no password. Enter your email and we send a one-tap magic link. Open it and you’re in.'
    },
    {
      q: 'Are the elixir costs official?',
      a: 'Yes. Card costs mirror the live Clash Royale card set. When Supercell rebalances, we update.'
    },
    {
      q: 'What counts for the leaderboards?',
      a: 'Every ranked mode has its own board, split by season and all-time. Practice runs never count.'
    },
    {
      q: 'Is Elixir Drop made by Supercell?',
      a: 'No. It’s a fan-made trainer by the POAP KINGS and is not affiliated with or endorsed by Supercell.'
    },
    {
      q: 'How do I install it on my phone?',
      a: 'Open the Install page from your profile and follow the steps — adding Drop to your home screen hides the browser bars for a full-screen game.'
    }
  ]
}

export const INSTALL: InstallContent = {
  eyebrow: 'Full-screen play',
  title: 'Install Elixir Drop',
  intro:
    'Add Drop to your home screen and the browser bars disappear — more room for falling cards, a cleaner game, and a one-tap launch icon.',
  ios: {
    label: 'iPhone · Safari',
    steps: [
      'Tap the Share button in the Safari toolbar.',
      'Scroll and choose “Add to Home Screen”.',
      'Tap Add — the Drop icon lands on your home screen.'
    ]
  },
  android: {
    label: 'Android · Chrome',
    steps: [
      'Tap the ⋮ menu in the top-right of Chrome.',
      'Choose “Install app” (or “Add to Home screen”).',
      'Confirm — Drop installs like a native app.'
    ]
  }
}
