type ChargeRequest = { status: string; plots: string[]; eventIds: string[] }

// Inputs use canonical plot names. A shared account is not evidence of payment for every plot.
export function reservedChargeIds(selectedPlots: string[], requests: ChargeRequest[]): Set<string> {
  const selected = new Set(selectedPlots)
  return new Set(requests
    .filter(request => ['PENDING', 'CONFIRMED'].includes(request.status) && request.plots.some(plot => selected.has(plot)))
    .flatMap(request => request.eventIds))
}

export function parsePaymentRubles(raw: string): number | null {
  const value = raw.trim().replace(/[ \u00a0\u202f]/g, '')
  if (!/^\d+$/.test(value)) return null
  const amount = Number(value)
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

export function paymentRequestErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'permission-denied') {
    return 'Не удалось отправить заявку из-за ограничений доступа. Обновите страницу и попробуйте снова. Если ошибка повторится, обратитесь к администратору.'
  }
  return error instanceof Error ? error.message : 'Не удалось отправить заявку. Попробуйте ещё раз.'
}
