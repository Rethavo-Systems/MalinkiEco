export function isChargeClosed(event: { type: string; isClosed: boolean; closesAtClient?: number }, now = Date.now()) {
  return event.isClosed || (event.type === 'CHARGE' && Number(event.closesAtClient ?? 0) > 0 && Number(event.closesAtClient) <= now)
}

export function validateChargeDeadline(value: number, now = Date.now()) {
  if (value !== 0 && (!Number.isFinite(value) || value <= now)) throw new Error('Дата закрытия должна быть в будущем.')
  return value
}
