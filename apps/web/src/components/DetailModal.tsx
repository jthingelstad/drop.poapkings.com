import type { ComponentChildren } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import Icon from './Icon'

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Shared, small detail dialog for profile drill-downs. It owns Escape,
// focus trapping/restoration, scroll locking, and backdrop dismissal so badge
// and season details behave identically on touch and keyboard.
export default function DetailModal({
  label,
  onClose,
  children,
  className = '',
  returnFocus
}: {
  label: string
  onClose: () => void
  children: ComponentChildren
  className?: string
  returnFocus?: HTMLElement | null
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    // Mobile Safari does not focus a button when it is tapped, so callers can
    // provide the actual trigger instead of relying on activeElement.
    const previouslyFocused = returnFocus ?? (document.activeElement as HTMLElement | null)
    document.body.classList.add('modal-open')
    card.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      const at = items.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && at <= 0) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (at === -1 || at === items.length - 1)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.classList.remove('modal-open')
      previouslyFocused?.focus?.()
    }
  }, [returnFocus])

  return (
    <div
      class="ed-detail-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={cardRef}
        class={`ed-detail-modal__card${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <button class="ed-detail-modal__close" aria-label="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
        {children}
      </div>
    </div>
  )
}
