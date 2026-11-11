import { useCallback } from 'react'

export function useChatViewport(active: boolean) {
  return useCallback((shell: HTMLDivElement | null) => {
    const viewport = window.visualViewport
    if (!active || !shell || !viewport) return

    let frame = 0
    const update = () => {
      // Leave browser zoom in control when the resident pinches to enlarge text.
      if (Math.abs(viewport.scale - 1) > 0.01) {
        shell.style.removeProperty('--chat-viewport-height')
        shell.style.removeProperty('--chat-viewport-top')
        delete shell.dataset.chatKeyboard
        return
      }
      shell.style.setProperty('--chat-viewport-height', `${Math.round(viewport.height)}px`)
      shell.style.setProperty('--chat-viewport-top', `${Math.round(viewport.offsetTop)}px`)
      shell.toggleAttribute('data-chat-keyboard', window.innerHeight - viewport.height > 110)
    }
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }

    update()
    viewport.addEventListener('resize', scheduleUpdate)
    viewport.addEventListener('scroll', scheduleUpdate)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', scheduleUpdate)
      viewport.removeEventListener('scroll', scheduleUpdate)
      shell.style.removeProperty('--chat-viewport-height')
      shell.style.removeProperty('--chat-viewport-top')
      delete shell.dataset.chatKeyboard
    }
  }, [active])
}
