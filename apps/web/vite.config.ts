import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { execSync } from 'node:child_process'
import { renderStaticPage, renderUpdatesFeed, STATIC_PAGE_SLUGS } from './scripts/static-pages.ts'

function runGit(command: string): string | undefined {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return undefined
  }
}

function buildId(): string {
  const envSha = process.env.GITHUB_SHA
  if (envSha) return envSha.slice(0, 12)

  const gitSha = runGit('git rev-parse --short=12 HEAD')
  if (!gitSha) return process.env.npm_package_version ? `v${process.env.npm_package_version}` : 'dev'

  const dirty = runGit('git status --porcelain')
  return dirty ? `${gitSha}-dirty` : gitSha
}

function versionManifestPlugin(webVersion: string): Plugin {
  const source = `${JSON.stringify({ webVersion })}\n`
  return {
    name: 'elixir-drop-version-manifest',
    configureServer(server) {
      server.middlewares.use('/version.json', (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next()
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(request.method === 'HEAD' ? undefined : source)
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source })
    }
  }
}

function staticPagesPlugin(): Plugin {
  const paths = new Map(STATIC_PAGE_SLUGS.map((slug) => [`/${slug}/`, slug]))
  return {
    name: 'elixir-drop-static-pages',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next()
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        if (pathname === '/feed.xml') {
          const source = renderUpdatesFeed()
          response.statusCode = 200
          response.setHeader('Content-Type', 'application/rss+xml; charset=utf-8')
          response.end(request.method === 'HEAD' ? undefined : source)
          return
        }
        const slug = paths.get(pathname.endsWith('/') ? pathname : `${pathname}/`)
        if (!slug) return next()
        const source = renderStaticPage(slug)
        response.statusCode = 200
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end(request.method === 'HEAD' ? undefined : source)
      })
    },
    generateBundle() {
      for (const slug of STATIC_PAGE_SLUGS) {
        this.emitFile({ type: 'asset', fileName: `${slug}/index.html`, source: renderStaticPage(slug) })
      }
      this.emitFile({ type: 'asset', fileName: 'feed.xml', source: renderUpdatesFeed() })
    }
  }
}

// Dev-only: when LOCAL_API is set, serve /api-config.json pointing at the local
// dev API (services/api/dev/server.ts) instead of the committed prod file. The
// committed public/api-config.json (prod) and production builds are untouched.
function localApiConfigPlugin(): Plugin {
  const port = process.env.LOCAL_API_PORT ?? '8787'
  const source = `${JSON.stringify({ apiBaseUrl: `http://localhost:${port}` })}\n`
  return {
    name: 'elixir-drop-local-api-config',
    apply: 'serve',
    configureServer(server) {
      if (!process.env.LOCAL_API) return
      server.middlewares.use('/api-config.json', (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next()
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(request.method === 'HEAD' ? undefined : source)
      })
      server.config.logger.info(`  ➜ LOCAL_API: /api-config.json → http://localhost:${port}`)
    }
  }
}

const currentBuildId = buildId()

export default defineConfig({
  plugins: [preact(), versionManifestPlugin(currentBuildId), staticPagesPlugin(), localApiConfigPlugin()],
  base: '/',
  define: {
    __ELIXIR_DROP_BUILD_ID__: JSON.stringify(currentBuildId),
    __ELIXIR_DROP_BUILD_DATE__: JSON.stringify(process.env.BUILD_DATE ?? new Date().toISOString())
  }
})
