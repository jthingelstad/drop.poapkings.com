import { afterEach, beforeEach, vi } from 'vitest'

const values = new Map<string, string>()
const storage: Storage = {
  get length() {
    return values.size
  },
  clear() {
    values.clear()
  },
  getItem(key: string) {
    return values.get(key) ?? null
  },
  key(index: number) {
    return [...values.keys()][index] ?? null
  },
  removeItem(key: string) {
    values.delete(key)
  },
  setItem(key: string, value: string) {
    values.set(key, value)
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true
})

Object.defineProperty(window, 'localStorage', {
  value: storage,
  configurable: true
})

Object.defineProperty(window, 'scrollTo', {
  value: vi.fn(),
  configurable: true
})

beforeEach(() => {
  localStorage.clear()
  window.location.hash = ''
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})
