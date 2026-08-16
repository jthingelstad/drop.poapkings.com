import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { execSync } from 'node:child_process'

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

const currentBuildId = buildId()

export default defineConfig({
  plugins: [preact(), versionManifestPlugin(currentBuildId)],
  base: '/',
  define: {
    __ELIXIR_DROP_BUILD_ID__: JSON.stringify(currentBuildId),
    __ELIXIR_DROP_BUILD_DATE__: JSON.stringify(process.env.BUILD_DATE ?? new Date().toISOString())
  }
})
