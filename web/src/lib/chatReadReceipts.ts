export type ChatReadersSelection = { messageId: string; viewerId: string }

// Recheck current messages and identity so an old menu or dialog cannot expose another author's receipts.
export function selectedOwnChatMessage<T extends { id: string; senderId: string }>(
  messages: readonly T[],
  viewerId: string,
  selection: ChatReadersSelection | null,
): T | null {
  if (!viewerId || !selection || selection.viewerId !== viewerId) return null
  return messages.find(message => message.id === selection.messageId && message.senderId === viewerId) ?? null
}
