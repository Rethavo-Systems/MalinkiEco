import { useEffect, useState } from 'react'
import { isTouchChatInput, TOUCH_CHAT_QUERY } from '../lib/chatMobileInteraction'

export function useTouchChatInteraction() {
  const [touch, setTouch] = useState(() => typeof window !== 'undefined' && window.matchMedia(TOUCH_CHAT_QUERY).matches)
  useEffect(() => {
    const media = window.matchMedia(TOUCH_CHAT_QUERY)
    const update = () => setTouch(media.matches)
    const pointer = (event: PointerEvent) => setTouch(isTouchChatInput(media.matches, event.pointerType))
    media.addEventListener('change', update)
    window.addEventListener('pointerdown', pointer)
    return () => { media.removeEventListener('change', update); window.removeEventListener('pointerdown', pointer) }
  }, [])
  return { touch, enableTouch: () => setTouch(true), enableMouse: () => setTouch(false) }
}
