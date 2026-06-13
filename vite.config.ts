import { defineConfig } from 'vite'
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

export default defineConfig({
  plugins: [preact()],
  base: '/',
  define: {
    __ELIXIR_DROP_BUILD_ID__: JSON.stringify(buildId()),
    __ELIXIR_DROP_BUILD_DATE__: JSON.stringify(process.env.BUILD_DATE ?? new Date().toISOString())
  }
})
