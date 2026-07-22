// The mobile "More" list at the bottom of Profile: About, FAQ, Install app,
// Discord (external), Privacy. Desktop uses the left-rail footer cluster
// instead, so this renders on the mobile shell only.

import { navigate } from '../lib/router'
import { ELIXIR_DROP_DISCORD_URL } from '../lib/links'
import Icon, { type IconName } from './Icon'

interface Row {
  key: string
  label: string
  icon: IconName
  to?: string
  href?: string
}

const ROWS: Row[] = [
  { key: 'about', label: 'About', icon: 'info', to: '/about' },
  { key: 'faq', label: 'FAQ', icon: 'circle-help', to: '/faq' },
  { key: 'install', label: 'Install app', icon: 'download', to: '/install' },
  { key: 'discord', label: 'Discord', icon: 'message-circle', href: ELIXIR_DROP_DISCORD_URL },
  { key: 'privacy', label: 'Privacy', icon: 'shield', to: '/privacy' }
]

export default function MetaMoreList() {
  return (
    <div class="ed-morelist">
      <div class="ed-morelist__label">More</div>
      <div class="ed-morelist__group">
        {ROWS.map((row) =>
          row.href ? (
            <a class="ed-morelist__row" key={row.key} href={row.href} target="_blank" rel="noopener noreferrer">
              <Icon name={row.icon} className="ed-morelist__lead" />
              <span class="ed-morelist__text">{row.label}</span>
              <Icon name="external-link" className="ed-morelist__end" />
            </a>
          ) : (
            <button class="ed-morelist__row tap-fx" key={row.key} onClick={() => navigate(row.to!)}>
              <Icon name={row.icon} className="ed-morelist__lead" />
              <span class="ed-morelist__text">{row.label}</span>
              <Icon name="chevron-right" className="ed-morelist__end" />
            </button>
          )
        )}
      </div>
    </div>
  )
}
