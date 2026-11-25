import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE_SELECTOR = 'a[href], button, input, select, textarea, [tabindex]'

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if ('disabled' in element && element.disabled) return false
    if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
    for (
      let node: HTMLElement | null = element;
      node && node !== dialog;
      node = node.parentElement
    ) {
      const style = window.getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return false
    }
    return true
  })
}

/** 基础模态焦点契约：打开聚焦、Tab 循环、Escape 关闭、关闭后恢复原焦点。 */
export function useModalFocus(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = focusableElements(dialog)
    ;(focusables[0] ?? dialog).focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const current = focusableElements(dialog)
      if (current.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = current[0]
      const last = current[current.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (returnTo?.isConnected) returnTo.focus()
    }
  }, [open, dialogRef])
}
