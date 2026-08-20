import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('refresh cards', () => {
  it('keeps mirrored card art read-only during a dry run', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-refresh-cards-'))
    tempDirectories.push(root)

    const scriptPath = join(root, 'apps/web/scripts/refresh-cards.mjs')
    const cardsPath = join(root, 'packages/game-data/cards.json')
    mkdirSync(dirname(scriptPath), { recursive: true })
    mkdirSync(dirname(cardsPath), { recursive: true })
    copyFileSync(join(process.cwd(), 'scripts/refresh-cards.mjs'), scriptPath)
    writeFileSync(join(root, '.env'), 'CR_API_TOKEN="test-token"\nMIRROR_IMAGES="true"\n')
    writeFileSync(
      cardsPath,
      JSON.stringify({
        version: '2026-08-01',
        count: 1,
        cards: [
          {
            id: 26000000,
            name: 'Knight',
            elixir: 3,
            rarity: 'common',
            type: 'troop',
            evo: false,
            hero: false,
            icon: '/cards/26000000.png'
          }
        ]
      })
    )

    const preload = `
      const payload = ${JSON.stringify({
        items: [
          {
            id: 26000000,
            name: 'Knight',
            elixirCost: 3,
            rarity: 'Common',
            maxEvolutionLevel: 0,
            iconUrls: { medium: 'https://example.test/knight.png' }
          }
        ],
        supportItems: []
      })};
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.endsWith('/cards')) {
          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        if (url === 'https://example.test/knight.png') {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        }
        return new Response(null, { status: 404 });
      };
    `
    const env = { ...process.env }
    delete env.CR_API_TOKEN
    delete env.CR_API_KEY
    delete env.MIRROR_IMAGES
    const result = spawnSync(
      process.execPath,
      ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, scriptPath, '--dry-run'],
      {
        encoding: 'utf8',
        env
      }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('No changes')
    expect(result.stdout).toContain('[dry-run] No files written.')
    expect(existsSync(join(root, 'apps/web/public/cards/26000000.png'))).toBe(false)
  })
})
