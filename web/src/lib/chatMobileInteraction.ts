export const TOUCH_CHAT_QUERY = '(hover: none) and (pointer: coarse)'

export type MobileMessageSelection = { messageId: string; viewerId: string }

export function currentMobileMessage<T extends { id: string }>(
  messages: readonly T[], viewerId: string, selection: MobileMessageSelection | null,
): T | null {
  if (!viewerId || !selection || selection.viewerId !== viewerId) return null
  return messages.find(message => message.id === selection.messageId) ?? null
}

// Mouse input stays on the desktop path, including a narrow desktop window.
export function isTouchChatInput(coarsePointer: boolean, pointerType?: string) {
  if (pointerType === 'mouse') return false
  if (pointerType === 'touch' || pointerType === 'pen') return true
  return coarsePointer
}

export function mobileMessagePermissions(message: { senderId: string } | null, viewerId: string) {
  const own = Boolean(viewerId && message?.senderId === viewerId)
  return { canReply: Boolean(message && viewerId), canEdit: own, canDelete: own, canViewReaders: own }
}
