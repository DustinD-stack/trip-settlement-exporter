/**
 * Slide-out navigation for phone-sized screens.
 *
 * The tab strip scrolls horizontally, which is fine on a desktop but means
 * hunting for "Settings & Backup" with a thumb. On narrow screens the strip is
 * replaced by a Menu button that opens this drawer, listing every section.
 *
 * Kept deliberately plain: a dialog, a list of buttons, and the same theme
 * tokens as the rest of the app.
 */
import { useEffect, useRef } from 'react'

export interface NavMenuItem<Id extends string> {
  id: Id
  label: string
}

export function NavMenu<Id extends string>({
  items,
  current,
  open,
  onSelect,
  onClose,
}: {
  items: ReadonlyArray<NavMenuItem<Id>>
  current: Id
  open: boolean
  onSelect: (id: Id) => void
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const firstButton = useRef<HTMLButtonElement>(null)
  /** Whatever had focus before the drawer opened, so it can be handed back. */
  const opener = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    opener.current = document.activeElement as HTMLElement | null
    // Move focus into the drawer so a keyboard or screen reader lands there.
    firstButton.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      // Keep Tab inside the drawer while it is open.
      const focusable = panel.current?.querySelectorAll<HTMLElement>('button')
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      opener.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="nav-menu-root">
      {/* Tapping the backdrop closes the drawer. */}
      <div className="nav-menu-backdrop" onClick={onClose} data-testid="nav-menu-backdrop" />
      <div
        className="nav-menu-panel"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Sections"
      >
        <div className="nav-menu-head">
          <h2 id="nav-menu-title">Go to section</h2>
          <button ref={firstButton} className="small" onClick={onClose}>
            Close
          </button>
        </div>
        <nav aria-labelledby="nav-menu-title">
          <ul className="nav-menu-list">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  className="nav-menu-item"
                  aria-current={item.id === current ? 'page' : undefined}
                  onClick={() => {
                    onSelect(item.id)
                    onClose()
                  }}
                >
                  <span>{item.label}</span>
                  {item.id === current && <span className="nav-menu-here">Current</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  )
}
