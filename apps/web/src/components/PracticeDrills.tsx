import Icon from './Icon'
import { navigate } from '../lib/router'

const DRILLS = [
  {
    path: '/practice/costs',
    name: 'Cost Recall',
    eyebrow: 'Card knowledge',
    description: 'Name card costs. Misses return after a retrieval gap until the answer sticks.',
    foot: 'Adaptive cards · Optional hints',
    icon: 'zap' as const
  },
  {
    path: '/practice/ledger',
    name: 'Ledger',
    eyebrow: 'Battle awareness',
    description: 'Follow Blue and Red plays, then call which side owns the elixir advantage.',
    foot: 'Adaptive sequences · Trade companion',
    icon: 'trending-up' as const
  }
]

export default function PracticeDrills() {
  return (
    <>
      <div class="practice-drills" role="region" aria-label="Practice drills">
        {DRILLS.map((drill, index) => (
          <button
            class={`practice-drill practice-drill--${index === 0 ? 'costs' : 'ledger'}`}
            key={drill.path}
            onClick={() => navigate(drill.path)}
          >
            <span class="practice-drill__visual" aria-hidden="true">
              <Icon name={drill.icon} />
              <span class="practice-drill__line" />
            </span>
            <span class="practice-drill__body">
              <span class="practice-drill__eyebrow">{drill.eyebrow}</span>
              <strong>{drill.name}</strong>
              <span>{drill.description}</span>
              <small>{drill.foot}</small>
            </span>
            <Icon name="chevron-right" className="practice-drill__arrow" />
          </button>
        ))}
      </div>

      <p class="practice-note">
        <Icon name="wifi-off" /> Both drills work offline. Offline learning stays on this device.
      </p>
    </>
  )
}
