import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  it('commits and pushes mirrored artwork atomically with the snapshot', () => {
    const root = mkdtempSync(join(tmpdir(), 'drop-refresh-cards-'))
    const remote = mkdtempSync(join(tmpdir(), 'drop-refresh-cards-remote-'))
    tempDirectories.push(root, remote)

    const scriptPath = join(root, 'apps/web/scripts/refresh-cards.mjs')
    const cardsPath = join(root, 'packages/game-data/cards.json')
    const baseArtPath = join(root, 'apps/web/public/cards/26000043.png')
    const evolutionArtPath = join(root, 'apps/web/public/cards/26000043_evo.png')
    mkdirSync(dirname(scriptPath), { recursive: true })
    mkdirSync(dirname(cardsPath), { recursive: true })
    mkdirSync(dirname(baseArtPath), { recursive: true })
    copyFileSync(join(process.cwd(), 'scripts/refresh-cards.mjs'), scriptPath)
    writeFileSync(join(root, '.env'), 'CR_API_TOKEN="test-token"\nMIRROR_IMAGES="true"\n')
    writeFileSync(
      cardsPath,
      JSON.stringify({
        version: new Date().toISOString().slice(0, 10),
        count: 1,
        cards: [
          {
            id: 26000043,
            name: 'Elite Barbarians',
            elixir: 6,
            rarity: 'common',
            type: 'troop',
            evo: true,
            hero: false,
            icon: '/cards/26000043.png',
            iconEvo: '/cards/26000043_evo.png'
          }
        ]
      })
    )
    writeFileSync(baseArtPath, new Uint8Array([9, 9, 9]))
    writeFileSync(evolutionArtPath, new Uint8Array([8, 8, 8]))

    execFileSync('git', ['init', '--initial-branch=main'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Refresh Cards Test'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'refresh-cards@example.test'], { cwd: root })
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'initial snapshot'], { cwd: root })
    execFileSync('git', ['init', '--bare'], { cwd: remote })
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root })
    execFileSync('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: root })

    const preload = `
      const payload = ${JSON.stringify({
        items: [
          {
            id: 26000043,
            name: 'Elite Barbarians',
            elixirCost: 6,
            rarity: 'Common',
            maxEvolutionLevel: 1,
            iconUrls: {
              medium: 'https://example.test/elite-barbarians.png',
              evolutionMedium: 'https://example.test/elite-barbarians-evo.png'
            }
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
        if (url === 'https://example.test/elite-barbarians.png') {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        }
        if (url === 'https://example.test/elite-barbarians-evo.png') {
          return new Response(new Uint8Array([4, 5, 6]), { status: 200 });
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
      ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, scriptPath],
      {
        encoding: 'utf8',
        env
      }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' })).toBe('')
    const committedPaths = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    })
    expect(committedPaths).toContain('apps/web/public/cards/26000043.png')
    expect(committedPaths).toContain('apps/web/public/cards/26000043_evo.png')
    expect(committedPaths).toContain('packages/game-data/cards.json')
    expect(readFileSync(baseArtPath)).toEqual(Buffer.from([1, 2, 3]))
    expect(readFileSync(evolutionArtPath)).toEqual(Buffer.from([4, 5, 6]))
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(
      execFileSync('git', ['rev-parse', 'refs/heads/main'], { cwd: remote, encoding: 'utf8' }).trim()
    )
  })

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

  it('defers a newly announced evolution until the official asset is available', () => {
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
            id: 26000043,
            name: 'Elite Barbarians',
            elixir: 6,
            rarity: 'common',
            type: 'troop',
            evo: false,
            hero: false,
            icon: '/cards/26000043.png'
          }
        ]
      })
    )

    const preload = `
      const payload = ${JSON.stringify({
        items: [
          {
            id: 26000043,
            name: 'Elite Barbarians',
            elixirCost: 6,
            rarity: 'Common',
            maxEvolutionLevel: 1,
            iconUrls: {
              medium: 'https://example.test/elite-barbarians.png',
              evolutionMedium: 'https://example.test/elite-barbarians-evo.png'
            }
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
        if (url === 'https://example.test/elite-barbarians.png') {
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
      ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, scriptPath, '--write'],
      {
        encoding: 'utf8',
        env
      }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Wrote packages/game-data/cards.json')
    expect(result.stderr).toContain(
      'Elite Barbarians evolution artwork is unavailable; omitting it until the official asset is published.'
    )
    expect(JSON.parse(readFileSync(cardsPath, 'utf8')).cards[0]).toMatchObject({
      evo: false,
      hero: false,
      icon: '/cards/26000043.png'
    })
    expect(JSON.parse(readFileSync(cardsPath, 'utf8')).cards[0]).not.toHaveProperty('iconEvo')
    expect(existsSync(join(root, 'apps/web/public/cards/26000043_evo.png'))).toBe(false)
  })

  it('vendors the published Minion Giant art while its API asset is unavailable', () => {
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
        version: '2026-08-14',
        count: 0,
        cards: []
      })
    )

    const fallbackUrl = 'https://cdn.royaleapi.com/static/img/cards/minion-giant.png'
    const preload = `
      const payload = ${JSON.stringify({
        items: [
          {
            id: 26000107,
            name: 'Minion Giant',
            elixirCost: 4,
            rarity: 'Rare',
            maxEvolutionLevel: 0,
            iconUrls: { medium: 'https://example.test/minion-giant.png' }
          }
        ],
        supportItems: []
      })};
      globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        if (url.endsWith('/cards')) {
          return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        if (url === 'https://example.test/minion-giant.png') {
          return new Response(null, { status: 404 });
        }
        if (url === ${JSON.stringify(fallbackUrl)}) {
          return new Response(init.method === 'HEAD' ? null : new Uint8Array([9, 8, 7]), { status: 200 });
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
      ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, scriptPath, '--write'],
      {
        encoding: 'utf8',
        env
      }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toContain('Using published image fallback for Minion Giant; API asset is unavailable.')
    expect(JSON.parse(readFileSync(cardsPath, 'utf8')).cards[0]).toMatchObject({
      id: 26000107,
      name: 'Minion Giant',
      elixir: 4,
      rarity: 'rare',
      type: 'troop',
      icon: '/cards/26000107.png'
    })
    expect(readFileSync(join(root, 'apps/web/public/cards/26000107.png'))).toEqual(Buffer.from([9, 8, 7]))
  })
})
