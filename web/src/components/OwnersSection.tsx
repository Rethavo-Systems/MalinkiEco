import { useState } from 'react'
import type { ManualPaymentRequest, RegistrationRequest, RemoteUser, Role } from '../types'
import { formatRussianPhone } from '../utils'

type OwnersSectionProps = {
  profile: RemoteUser
  owners: RemoteUser[]
  paymentRequests: ManualPaymentRequest[]
  registrationRequests: RegistrationRequest[]
  formatPlots: (user: Pick<RemoteUser, 'plotName' | 'plots'>) => string
  balanceTone: (balance: number) => string
  balanceLabel: (balance: number) => string
  roleLabel: (role: Role) => string
  formatDateTime: (value: number) => string
  pendingPaymentRequestsCount: number
  pendingRegistrationRequestsCount: number
  onSetBalance: (user: RemoteUser, newBalance: number) => void | Promise<void>
  onDeleteUser: (user: RemoteUser) => void | Promise<void>
  onToggleModerator: (user: RemoteUser, nextRole: Role) => void | Promise<void>
  onApproveRegistration: (request: RegistrationRequest) => void | Promise<void>
  onRejectRegistration: (request: RegistrationRequest, reason: string) => void | Promise<void>
  onConfirmPayment: (request: ManualPaymentRequest) => void | Promise<void>
  onRejectPayment: (request: ManualPaymentRequest, reason: string) => void | Promise<void>
}

function paymentStatusLabel(request: ManualPaymentRequest) {
  switch (request.status) {
    case 'PENDING':
      return 'Ожидает подтверждения'
    case 'CONFIRMED':
      return request.reviewedByName ? `Подтверждено: ${request.reviewedByName}` : 'Подтверждено'
    case 'REJECTED':
      return request.reviewedByName ? `Отклонено: ${request.reviewedByName}` : 'Отклонено'
    default:
      return request.status
  }
}

function registrationStatusLabel(request: RegistrationRequest) {
  switch (request.status) {
    case 'PENDING':
      return 'Ожидает рассмотрения'
    case 'APPROVED':
      return request.reviewedByName ? `Одобрено: ${request.reviewedByName}` : 'Одобрено'
    case 'REJECTED':
      return request.reviewedByName ? `Отклонено: ${request.reviewedByName}` : 'Отклонено'
    default:
      return request.status
  }
}

function requestTypeLabel(request: RegistrationRequest) {
  return request.requestType === 'PROFILE_UPDATE' ? 'Запрос на изменение данных' : 'Заявка на регистрацию'
}

function ownerRoleLabel(owner: RemoteUser, roleLabel: (role: Role) => string) {
  return owner.isPlaceholder ? 'Не зарегистрирован' : roleLabel(owner.role)
}

export function OwnersSection({
  profile,
  owners,
  paymentRequests,
  registrationRequests,
  formatPlots,
  balanceTone,
  balanceLabel,
  roleLabel,
  formatDateTime,
  pendingPaymentRequestsCount,
  pendingRegistrationRequestsCount,
  onSetBalance,
  onDeleteUser,
  onToggleModerator,
  onApproveRegistration,
  onRejectRegistration,
  onConfirmPayment,
  onRejectPayment,
}: OwnersSectionProps) {
  const isStaff = profile.role === 'ADMIN' || profile.role === 'MODERATOR'
  const canManageRoles = profile.role === 'ADMIN'
  const [showPaymentRequests, setShowPaymentRequests] = useState(false)
  const [showRegistrationRequests, setShowRegistrationRequests] = useState(false)

  return (
    <section className="panel">
      <div className="panel-heading">
        <p className="eyebrow accent">Раздел</p>
        <h2>Собственники</h2>
        <p>Список собственников и их участков. Цвет карточки показывает состояние баланса.</p>
      </div>

      {isStaff && (
        <div className="stack" style={{ marginBottom: 18 }}>
          <div className="poll-create-card">
            <div className="poll-create-card__header">
              <div>
                <h3 className="section-title-with-badge">
                  <span>Заявки на оплату</span>
                  {pendingPaymentRequestsCount > 0 && <span className="alert-badge">{pendingPaymentRequestsCount}</span>}
                </h3>
                <p>Проверка переводов, которые отправили собственники.</p>
              </div>
              <button className="ghost-button" type="button" onClick={() => setShowPaymentRequests((value) => !value)}>
                {showPaymentRequests ? 'Свернуть' : 'Развернуть'}
              </button>
            </div>

            {showPaymentRequests && (
              <div className="stack">
                {paymentRequests.length === 0 ? (
                  <div className="chat-empty-inline">Пока нет заявок на оплату.</div>
                ) : (
                  paymentRequests.map((request) => (
                    <article key={request.id} className="event-card">
                      <div className="event-meta">
                        <span className="event-badge">{paymentStatusLabel(request)}</span>
                        <span>{formatDateTime(request.createdAtClient)}</span>
                      </div>
                      <h3>{request.userName}</h3>
                      <p>{request.plotName}</p>
                      <p>{request.eventTitle || request.purpose || 'Без назначения'}</p>
                      <strong className="event-amount">{request.amount.toLocaleString('ru-RU')} ₽</strong>
                      {request.reviewReason && <p>Причина: {request.reviewReason}</p>}
                      {request.status === 'PENDING' && (
                        <div className="chat-actions">
                          <button className="primary-button" type="button" onClick={() => void onConfirmPayment(request)}>
                            Подтвердить
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() => {
                              const reason = window.prompt('Причина отклонения', request.reviewReason) ?? ''
                              void onRejectPayment(request, reason)
                            }}
                          >
                            Отклонить
                          </button>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="poll-create-card">
            <div className="poll-create-card__header">
              <div>
                <h3 className="section-title-with-badge">
                  <span>Заявки пользователей</span>
                  {pendingRegistrationRequestsCount > 0 && (
                    <span className="alert-badge">{pendingRegistrationRequestsCount}</span>
                  )}
                </h3>
                <p>Одобрение новых регистраций и запросов на изменение данных.</p>
              </div>
              <button className="ghost-button" type="button" onClick={() => setShowRegistrationRequests((value) => !value)}>
                {showRegistrationRequests ? 'Свернуть' : 'Развернуть'}
              </button>
            </div>

            {showRegistrationRequests && (
              <div className="stack">
                {registrationRequests.length === 0 ? (
                  <div className="chat-empty-inline">Пока нет заявок пользователей.</div>
                ) : (
                  registrationRequests.map((request) => (
                    <article key={request.id} className="event-card">
                      <div className="event-meta">
                        <span className="event-badge">{registrationStatusLabel(request)}</span>
                        <span>{formatDateTime(request.createdAtClient)}</span>
                      </div>
                      <h3>{requestTypeLabel(request)}</h3>
                      <p>{request.authEmail || request.login}</p>
                      {request.requestType === 'PROFILE_UPDATE' ? (
                        <div className="stack">
                          <p>Текущие данные: {request.currentFullName || request.fullName}</p>
                          {(request.currentPhone || request.phone) && (
                            <p>Текущий телефон: {formatRussianPhone(request.currentPhone || request.phone)}</p>
                          )}
                          <p>Новые данные: {request.proposedFullName || request.fullName}</p>
                          {(request.proposedPhone || request.phone) && (
                            <p>Новый телефон: {formatRussianPhone(request.proposedPhone || request.phone)}</p>
                          )}
                          <p>{request.plots.join(', ')}</p>
                        </div>
                      ) : (
                        <div className="stack">
                          <p>{request.fullName}</p>
                          <p>{request.plots.join(', ')}</p>
                          {request.phone && <p>{formatRussianPhone(request.phone)}</p>}
                        </div>
                      )}
                      {request.reviewReason && <p>Причина: {request.reviewReason}</p>}
                      {request.status === 'PENDING' && (
                        <div className="chat-actions">
                          <button className="primary-button" type="button" onClick={() => void onApproveRegistration(request)}>
                            Одобрить
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() => {
                              const reason = window.prompt('Причина отклонения', request.reviewReason) ?? ''
                              void onRejectRegistration(request, reason)
                            }}
                          >
                            Отклонить
                          </button>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="owners-grid">
        {owners.map((owner) => (
          <article key={owner.id} className={`owner-card ${balanceTone(owner.balance)}`}>
            <h3>{owner.fullName}</h3>
            <p>{formatPlots(owner)}</p>
            <span className="owner-role">{ownerRoleLabel(owner, roleLabel)}</span>
            {isStaff && !owner.isPlaceholder && owner.phone && <p>{formatRussianPhone(owner.phone)}</p>}
            {isStaff && !owner.isPlaceholder && owner.email && <p>{owner.email}</p>}
            <strong>{owner.balance.toLocaleString('ru-RU')} ₽</strong>
            <span>{balanceLabel(owner.balance)}</span>
            {isStaff && (
              <div className="chat-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    const value = window.prompt('Новый баланс', String(owner.balance))
                    if (value === null) return
                    const parsed = Number(value.replace(',', '.'))
                    if (Number.isNaN(parsed)) return
                    void onSetBalance(owner, Math.round(parsed))
                  }}
                >
                  Изменить баланс
                </button>
                {canManageRoles && !owner.isPlaceholder && owner.role !== 'ADMIN' && (
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void onToggleModerator(owner, owner.role === 'MODERATOR' ? 'USER' : 'MODERATOR')}
                  >
                    {owner.role === 'MODERATOR' ? 'Снять модератора' : 'Сделать модератором'}
                  </button>
                )}
                {!owner.isPlaceholder && owner.role !== 'ADMIN' && (
                  <button className="danger-button" type="button" onClick={() => void onDeleteUser(owner)}>
                    Удалить
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
