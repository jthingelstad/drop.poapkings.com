import Icon from './Icon'
import { navigate } from '../lib/router'
import { PRACTICE_LEDGER_ENABLED } from '../lib/practice-navigation'

const DRILLS = [
  {
    path: '/practice/costs',
    name: 'Cost Recall',
    eyebrow: 'Card knowledge',
    description: 'Name card costs. Misses return after a retrieval gap until the answer sticks.',
    foot: 'Adaptive cards · Optional hints',
    icon: 'zap' as const,
    visible: true
  },
  {
    path: '/practice/ledger',
    name: 'Ledger',
    eyebrow: 'Battle awareness',
    description: 'Follow Blue and Red plays, then call which side owns the elixir advantage.',
    foot: 'Adaptive sequences · Trade companion',
    icon: 'trending-up' as const,
    visible: PRACTICE_LEDGER_ENABLED
  }
].filter((drill) => drill.visible)

export default function PracticeDrills() {
  return (
    <>
      <div class="practice-drills" role="region" aria-label="Practice drills">
        {DRILLS.map((drill) => (
          <button
            class={`practice-drill practice-drill--${drill.path.endsWith('/ledger') ? 'ledger' : 'costs'}`}
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
        <Icon name="wifi-off" /> Cost Recall works offline. Offline learning stays on this device.
      </p>
    </>
  )
}
