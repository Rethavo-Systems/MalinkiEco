export const TOUCH_CHAT_QUERY = '(hover: none) and (pointer: coarse)'

export type MobileMessageSelection = { messageId: string; viewerId: string }
export type MobileMessageGroupSelection = { messageIds: ReadonlySet<string>; viewerId: string }

export function currentMobileMessage<T extends { id: string }>(
  messages: readonly T[], viewerId: string, selection: MobileMessageSelection | null,
): T | null {
  if (!viewerId || !selection || selection.viewerId !== viewerId) return null
  return messages.find(message => message.id === selection.messageId) ?? null
}

export function currentMobileMessages<T extends { id: string }>(
  messages: readonly T[], viewerId: string, selection: MobileMessageGroupSelection | null,
): T[] {
  if (!viewerId || selection?.viewerId !== viewerId) return []
  return messages.filter(message => selection.messageIds.has(message.id))
}

export function updateMobileMessageGroup(
  selection: MobileMessageGroupSelection | null, viewerId: string, messageId: string, selected: boolean,
): MobileMessageGroupSelection | null {
  const current = selection?.viewerId === viewerId ? selection : null
  if (!viewerId || (current?.messageIds.has(messageId) ?? false) === selected) return selection
  const messageIds = new Set(current?.messageIds)
  if (selected) messageIds.add(messageId)
  else messageIds.delete(messageId)
  return messageIds.size ? { viewerId, messageIds } : null
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
