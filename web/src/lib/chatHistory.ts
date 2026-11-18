type DatedMessage = { id: string; createdAtClient: number }

export function mergeChatHistory<T extends DatedMessage>(recent: readonly T[], pinned: readonly T[]): T[] {
  const byId = new Map(pinned.map(message => [message.id, message]))
  recent.forEach(message => byId.set(message.id, message))
  return [...byId.values()].sort((left, right) => left.createdAtClient - right.createdAtClient || left.id.localeCompare(right.id))
}
