import type { ManualPaymentRequest, RegistrationRequest } from '../types'

type DatedRecord = { id: string; createdAtClient: number; reviewedAtClient?: number }

function validTime(value: number | undefined) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0
}

export function newestCreatedFirst(left: DatedRecord, right: DatedRecord) {
  return validTime(right.createdAtClient) - validTime(left.createdAtClient) || left.id.localeCompare(right.id)
}

export function newestReviewedFirst(left: DatedRecord, right: DatedRecord) {
  const leftTime = validTime(left.reviewedAtClient) || validTime(left.createdAtClient)
  const rightTime = validTime(right.reviewedAtClient) || validTime(right.createdAtClient)
  return rightTime - leftTime || newestCreatedFirst(left, right)
}

export function paymentRequestHistory(requests: ManualPaymentRequest[]) {
  return {
    active: requests.filter(request => request.status === 'PENDING').sort(newestCreatedFirst),
    archive: requests.filter(request => request.status === 'CONFIRMED' || request.status === 'REJECTED').sort(newestReviewedFirst),
  }
}

export function registrationRequestHistory(requests: RegistrationRequest[]) {
  return {
    active: requests.filter(request => request.status === 'PENDING').sort(newestCreatedFirst),
    archive: requests.filter(request => request.status === 'APPROVED' || request.status === 'REJECTED').sort(newestReviewedFirst),
  }
}

export function paymentRequestDescription(request: Pick<ManualPaymentRequest, 'purpose' | 'eventTitle'>) {
  const purpose = request.purpose.trim()
  const linkedCharges = request.eventTitle.trim()
  return {
    purpose: purpose || 'Без назначения',
    linkedCharges: linkedCharges !== purpose ? linkedCharges : '',
  }
}

export function paymentRequestPlots(request: Pick<ManualPaymentRequest, 'plotIds' | 'plotName'>) {
  const rawPlots = request.plotIds.length ? request.plotIds : request.plotName.split(',')
  const plots = [...new Set(rawPlots.map(plot => plot.trim().replace(/^участок\s*/i, '').trim()).filter(Boolean))]
  return plots.length ? `${plots.length === 1 ? 'Участок' : 'Участки'} ${plots.join(', ')}` : 'Участки не указаны'
}
