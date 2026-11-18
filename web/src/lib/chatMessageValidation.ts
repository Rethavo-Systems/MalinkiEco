export const CHAT_MESSAGE_MAX_LENGTH = 4000

export function assertChatMessageLength(text: string): void {
  if (text.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new Error(`В сообщении может быть не больше ${CHAT_MESSAGE_MAX_LENGTH} символов. Сократите текст или отправьте его частями.`)
  }
}
