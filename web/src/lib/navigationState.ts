export function balanceIndicator(balance: number) {
  if (balance < 0) return { tone: 'debt', label: `Задолженность: ${Math.abs(balance).toLocaleString('ru-RU')} ₽` }
  if (balance > 0) return { tone: 'credit', label: `Переплата: ${balance.toLocaleString('ru-RU')} ₽` }
  return { tone: 'clear', label: 'Задолженности нет' }
}

export function pendingRequestCount(requests: { id: string; status: string }[]) {
  return new Set(requests.filter(request => request.status === 'PENDING').map(request => request.id)).size
}

export function isPersonalEventVisible(targetUserId: string | undefined, userId: string) {
  return !targetUserId || targetUserId === userId
}
