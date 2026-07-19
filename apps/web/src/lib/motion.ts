// Reduced-motion override. The OS `prefers-reduced-motion` is always honored in
// CSS; this lets the player force it on regardless via Settings. We toggle a root
// class that the stylesheet gates all celebratory FX on (Surge keeps its timer +
// red flash either way).

import { getSettings } from './storage'

export function applyReducedMotion(on: boolean): void {
  document.documentElement.classList.toggle('reduce-motion', on)
}

export function initReducedMotion(): void {
  applyReducedMotion(Boolean(getSettings().reducedMotion))
}

export function isReducedMotionEnabled(): boolean {
  if (document.documentElement.classList.contains('reduce-motion')) return true
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
