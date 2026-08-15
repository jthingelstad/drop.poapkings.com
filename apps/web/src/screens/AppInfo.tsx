import { useSignal, type Signal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import Icon from '../components/Icon'
import MetaPageHead from '../components/MetaPageHead'
import { SpeedrunKeyboardPreference } from '../components/PlayerPreferences'
import { buildMeta } from '../lib/build'
import { allCards, cardCatalogVersion } from '../lib/card-catalog'
import { getCardArtCacheInfo, type CardArtCacheInfo } from '../lib/card-art-cache'
import { getApiDiagnostics, type ApiDiagnostics } from '../lib/api'
import { standaloneApp } from '../lib/pwa-install'

function workerLabel(state: CardArtCacheInfo['workerState']): string {
  if (state === 'activated') return 'Active'
  if (state === 'parsed' || state === 'installing') return 'Installing'
  if (state === 'installed') return 'Waiting to activate'
  if (state === 'activating') return 'Activating'
  if (state === 'redundant') return 'Needs refresh'
  if (state === 'unsupported') return 'Unavailable'
  return 'Not registered'
}

function cacheHeadline(info: CardArtCacheInfo | null, failed: boolean): string {
  if (failed) return 'Status unavailable'
  if (!info) return 'Checking card library…'
  if (!info.supported) return 'Caching unavailable'
  if (info.ready) return 'Offline card art ready'
  return 'Downloading card art'
}

function cacheDetail(info: CardArtCacheInfo | null, failed = false): string {
  if (failed) return 'Could not read this device’s cache'
  if (!info) return 'Reading this device’s cache…'
  return `${info.cachedCount} of ${info.totalCount} card images cached`
}

function readiness(
  apiInfo: ApiDiagnostics | null,
  apiFailed: boolean,
  cacheInfo: CardArtCacheInfo | null
): { title: string; detail: string; tone: 'checking' | 'ready' | 'caching' | 'error' } {
  if (cacheInfo?.ready && cacheInfo.workerState === 'activated' && apiFailed) {
    return {
      title: 'Ready to play offline',
      detail: 'Every game and the complete card library are local. Runs will not be saved or ranked.',
      tone: 'ready'
    }
  }
  if (apiFailed) {
    return {
      title: 'Connection issue',
      detail: 'Player services did not answer this device’s readiness check.',
      tone: 'error'
    }
  }
  if (!apiInfo || !cacheInfo) {
    return { title: 'Checking your setup…', detail: 'Testing player services and local card art.', tone: 'checking' }
  }
  if (cacheInfo.ready && cacheInfo.workerState === 'activated') {
    return {
      title: 'Ready online and offline',
      detail: 'Player services are online and every game has the complete local card library.',
      tone: 'ready'
    }
  }
  return {
    title: 'Connected · card art downloading',
    detail: `${cacheInfo.totalCount - cacheInfo.cachedCount} images remain. You can play while the library finishes.`,
    tone: 'caching'
  }
}

function readinessIcon(tone: ReturnType<typeof readiness>['tone']) {
  if (tone === 'ready') return 'zap' as const
  if (tone === 'error') return 'triangle-alert' as const
  if (tone === 'caching') return 'download' as const
  return 'loader-circle' as const
}

type MountedRef = { readonly current: boolean }

async function updateCacheInfo(
  mounted: MountedRef,
  refreshing: Signal<boolean>,
  info: Signal<CardArtCacheInfo | null>,
  failed: Signal<boolean>
) {
  if (refreshing.value) return
  refreshing.value = true
  try {
    const next = await getCardArtCacheInfo()
    if (!mounted.current) return
    info.value = next
    failed.value = false
  } catch {
    if (mounted.current) failed.value = true
  } finally {
    if (mounted.current) refreshing.value = false
  }
}

async function updateApiInfo(
  mounted: MountedRef,
  refreshing: Signal<boolean>,
  info: Signal<ApiDiagnostics | null>,
  failed: Signal<boolean>
) {
  if (refreshing.value) return
  refreshing.value = true
  try {
    const next = await getApiDiagnostics()
    if (!mounted.current) return
    info.value = next
    failed.value = false
  } catch {
    if (!mounted.current) return
    info.value = null
    failed.value = true
  } finally {
    if (mounted.current) refreshing.value = false
  }
}

export default function AppInfo() {
  const cacheInfo = useSignal<CardArtCacheInfo | null>(null)
  const cacheFailed = useSignal(false)
  const cacheRefreshing = useSignal(false)
  const apiInfo = useSignal<ApiDiagnostics | null>(null)
  const apiFailed = useSignal(false)
  const apiRefreshing = useSignal(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    void updateCacheInfo(mounted, cacheRefreshing, cacheInfo, cacheFailed)
    void updateApiInfo(mounted, apiRefreshing, apiInfo, apiFailed)
    const cacheTimer = window.setInterval(() => {
      if (!cacheInfo.value?.ready) void updateCacheInfo(mounted, cacheRefreshing, cacheInfo, cacheFailed)
    }, 2_000)
    const apiTimer = window.setInterval(() => void updateApiInfo(mounted, apiRefreshing, apiInfo, apiFailed), 15_000)
    return () => {
      mounted.current = false
      window.clearInterval(cacheTimer)
      window.clearInterval(apiTimer)
    }
  }, [apiFailed, apiInfo, apiRefreshing, cacheFailed, cacheInfo, cacheRefreshing])

  const info = cacheInfo.value
  const progress = info?.totalCount ? Math.min(100, (info.cachedCount / info.totalCount) * 100) : 0
  const connection = apiInfo.value
  const ready = readiness(connection, apiFailed.value, info)
  const refreshing = cacheRefreshing.value || apiRefreshing.value

  return (
    <article class="ed-page ed-appinfo">
      <MetaPageHead eyebrow={standaloneApp.value ? 'Installed app' : 'App diagnostics'} title="App Info" />

      <section class={`ed-appinfo__ready ed-appinfo__ready--${ready.tone}`} aria-live="polite">
        <Icon name={readinessIcon(ready.tone)} />
        <div>
          <h2>{ready.title}</h2>
          <p>{ready.detail}</p>
        </div>
      </section>

      <section class="ed-appinfo__api" aria-labelledby="api-status-title" aria-live="polite">
        <div>
          <div class="ed-appinfo__label">Player API</div>
          <h2 id="api-status-title">{apiFailed.value ? 'Unavailable' : connection ? 'Online' : 'Checking…'}</h2>
        </div>
        <div class="ed-appinfo__latency">
          <strong>{connection ? connection.latencyMs : '—'}</strong>
          <span>{connection ? 'ms' : 'latency'}</span>
        </div>
        <code class="ed-appinfo__endpoint">{connection?.endpoint ?? 'Resolving endpoint…'}</code>
        <p>
          This round trip affects game preparation and submission—not the in-game clock, which starts only after your
          challenge is ready.
        </p>
      </section>

      <section class="ed-appinfo__cache" aria-labelledby="card-cache-title" aria-live="polite">
        <div class={`ed-appinfo__cache-icon${info?.ready ? ' ed-appinfo__cache-icon--ready' : ''}`} aria-hidden="true">
          <Icon name={info?.ready ? 'check' : 'download'} />
        </div>
        <div class="ed-appinfo__cache-copy">
          <h2 id="card-cache-title">{cacheHeadline(info, cacheFailed.value)}</h2>
          <p>{cacheDetail(info, cacheFailed.value)}</p>
        </div>
        <div
          class="ed-appinfo__progress"
          role="progressbar"
          aria-label="Card art cache progress"
          aria-valuemin={0}
          aria-valuemax={info?.totalCount ?? 1}
          aria-valuenow={info?.cachedCount ?? 0}
          aria-valuetext={cacheDetail(info, cacheFailed.value)}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <p class="ed-appinfo__cache-note">
          Cached images load from this device in every mode. A connection is needed only to save runs, update progress
          and rankings, read live player data, and receive app updates.
        </p>
      </section>

      <section class="ed-appinfo__performance" aria-labelledby="performance-input-title">
        <div class="ed-appinfo__label">Performance input</div>
        <h2 id="performance-input-title">Keyboard setup</h2>
        <SpeedrunKeyboardPreference />
        <p>Applies to Surge, Practice, Survival, and Rain so the same key layout follows you into every run.</p>
      </section>

      <dl class="settings-meta ed-appinfo__meta" aria-label="App information">
        <div class="settings-meta__row">
          <dt>Running as</dt>
          <dd>{standaloneApp.value ? 'Installed app' : 'Browser tab'}</dd>
        </div>
        <div class="settings-meta__row">
          <dt>Build ID</dt>
          <dd>
            <code>{buildMeta.id}</code>
          </dd>
        </div>
        <div class="settings-meta__row">
          <dt>Build date</dt>
          <dd>
            <time dateTime={buildMeta.dateIso}>{buildMeta.dateLabel}</time>
          </dd>
        </div>
        <div class="settings-meta__row">
          <dt>Card catalog</dt>
          <dd>
            <code>{cardCatalogVersion}</code> · {allCards.length} cards
          </dd>
        </div>
        <div class="settings-meta__row">
          <dt>API endpoint</dt>
          <dd>
            <code>{connection?.endpoint ?? 'Checking…'}</code>
          </dd>
        </div>
        <div class="settings-meta__row">
          <dt>API latency</dt>
          <dd>{connection ? `${connection.latencyMs} ms` : apiFailed.value ? 'Unavailable' : 'Checking…'}</dd>
        </div>
        <div class="settings-meta__row">
          <dt>Service worker</dt>
          <dd>{cacheFailed.value ? 'Unavailable' : info ? workerLabel(info.workerState) : 'Checking…'}</dd>
        </div>
        <div class="settings-meta__row">
          <dt>Card cache</dt>
          <dd>{cacheDetail(info, cacheFailed.value)}</dd>
        </div>
      </dl>

      <button
        class="ed-btn ed-btn--ghost ed-btn--sm ed-appinfo__refresh tap-fx"
        onClick={() =>
          void Promise.all([
            updateCacheInfo(mounted, cacheRefreshing, cacheInfo, cacheFailed),
            updateApiInfo(mounted, apiRefreshing, apiInfo, apiFailed)
          ])
        }
        disabled={refreshing}
      >
        <span class="tap-face">
          <Icon name={refreshing ? 'loader-circle' : 'refresh-cw'} />
          {refreshing ? 'Checking…' : 'Refresh status'}
        </span>
      </button>
    </article>
  )
}
