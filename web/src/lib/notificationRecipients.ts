type Recipient = { id: string; role: string; email: string; notificationSettings: Record<string, boolean> }

export function staffRecipients(users: Pick<Recipient, 'id' | 'role'>[]) {
  return [...new Set(users.filter(user => ['ADMIN', 'MODERATOR'].includes(user.role)).map(user => user.id).filter(Boolean))]
}

export function notificationEmailTargets(users: Recipient[], category: string, targets?: string[], excluded: string[] = []) {
  const key = ['events', 'polls', 'payments', 'chat', 'mentions', 'requests'].includes(category) ? category : 'system'
  const targetSet = targets ? new Set(targets) : null
  const excludedSet = new Set(excluded)
  return [...new Set(users.filter(user => user.id && !excludedSet.has(user.id)
    && (!targetSet || targetSet.has(user.id)) && user.notificationSettings[key] !== false)
    .map(user => user.email.trim().toLowerCase()).filter(email => email.includes('@')))]
}
