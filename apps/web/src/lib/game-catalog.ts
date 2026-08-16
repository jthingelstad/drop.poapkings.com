// Public names, descriptions, routes, and artwork for the six shipped modes.
// The app and the generated, indexable game guide both read this catalog so
// discovery copy cannot drift from the game picker.
export const GAME_CATALOG = [
  {
    mode: 'surge',
    path: '/surge',
    name: 'Surge',
    icon: '⚡',
    art: '/assets/modes/surge-192.png',
    description: '15 cards. Name each elixir cost against the clock.'
  },
  {
    mode: 'practice',
    path: '/practice',
    name: 'Practice',
    icon: '🎯',
    art: '/assets/modes/practice-192.png',
    description: 'Learn elixir costs at your own pace — no clock, no rankings.',
    unranked: true
  },
  {
    mode: 'higher-lower',
    path: '/higher-lower',
    name: 'Higher / Lower',
    icon: '⚖️',
    art: '/assets/modes/higher-lower-192.png',
    description: 'Two cards — which one costs more? 3 lives.'
  },
  {
    mode: 'trade',
    path: '/trade',
    name: 'Trade',
    icon: '👑',
    art: '/assets/modes/trade-192.png',
    description: 'Read the elixir trade from Blue King side.'
  },
  {
    mode: 'survival',
    path: '/survival',
    name: 'Survival',
    icon: '💀',
    art: '/assets/modes/survival-192.png',
    description: 'Sudden death — one miss ends the run.'
  },
  {
    mode: 'rain',
    path: '/rain',
    name: 'Rain',
    icon: '🌧️',
    art: '/assets/modes/rain-192.png',
    description: 'Cards fall from the sky — clear each cost before it lands. 3 lives.'
  }
] as const
