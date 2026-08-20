import { signal } from '@preact/signals'

export const keyboardHelpOpen = signal(false)

export function openKeyboardHelp(): void {
  keyboardHelpOpen.value = true
}

export function closeKeyboardHelp(): void {
  keyboardHelpOpen.value = false
}
