// The mobile "More" list at the bottom of Profile: About, Releases, FAQ,
// public information pages, app diagnostics, and Discord. Desktop uses the
// left-rail footer cluster instead, so this renders on the mobile shell only.

import { navigate } from '../lib/router'
import { standaloneApp } from '../lib/pwa-install'
import Icon, { type IconName } from './Icon'

interface Row {
  key: string
  label: string
  icon: IconName
  to?: string
  href?: string
}

const ROWS: Row[] = [
  { key: 'about', label: 'About', icon: 'info', href: '/about/' },
  { key: 'releases', label: 'Releases', icon: 'sparkles', href: '/releases/' },
  { key: 'faq', label: 'FAQ', icon: 'circle-help', href: '/faq/' },
  { key: 'fair-play', label: 'Fair Play', icon: 'scan-eye', href: '/fair-play/' },
  { key: 'discord', label: 'Discord', icon: 'message-circle', href: '/discord/' },
  { key: 'privacy', label: 'Privacy', icon: 'shield', href: '/privacy/' }
]

export default function MetaMoreList() {
  const installRow: Row = standaloneApp.value
    ? { key: 'app-info', label: 'App Info', icon: 'info', to: '/app-info' }
    : { key: 'install', label: 'Game Setup', icon: 'download', href: '/install/' }
  const rows = [...ROWS.slice(0, 4), installRow, ...ROWS.slice(4)]

  return (
    <div class="ed-morelist">
      <div class="ed-morelist__label">More</div>
      <div class="ed-morelist__group">
        {rows.map((row) =>
          row.href ? (
            <a class="ed-morelist__row" key={row.key} href={row.href}>
              <Icon name={row.icon} className="ed-morelist__lead" />
              <span class="ed-morelist__text">{row.label}</span>
              <Icon name="chevron-right" className="ed-morelist__end" />
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
