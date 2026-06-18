import { useEffect, useMemo, useState } from 'react'
import { normalizePlots } from '../lib/plotAccounts'
import type { CommunityEvent, ManualPaymentRequest, PaymentTransferConfig, RemoteUser } from '../types'

type PaymentDetail = {
  label: string
  value: string
}

type PaymentConfigDraft = {
  recipientName: string
  recipientPhone: string
  bankName: string
  accountNumber: string
  paymentPurpose: string
  bik: string
  correspondentAccount: string
  recipientInn: string
  recipientKpp: string
  sbpLink: string
}

type PaymentsSectionProps = {
  profile: RemoteUser
  paymentConfig: PaymentTransferConfig
  communityFunds: number
  events: CommunityEvent[]
  paymentRequests: ManualPaymentRequest[]
  balanceTone: (balance: number) => string
  balanceLabel: (balance: number) => string
  hasAnyPaymentDetails: (config: PaymentTransferConfig) => boolean
  paymentDetails: (config: PaymentTransferConfig) => PaymentDetail[]
  onOpenPaymentLink: () => void
  onCopyAllPaymentDetails: () => void | Promise<void>
  onCopyDetail: (value: string, label: string) => void | Promise<void>
  onSubmitPaymentRequest: (amount: number, events: CommunityEvent[], purpose: string) => void | Promise<void>
  onSavePaymentConfig: (config: PaymentConfigDraft) => void | Promise<void>
}

const EMPTY_CONFIG: PaymentConfigDraft = {
  recipientName: '',
  recipientPhone: '',
  bankName: '',
  accountNumber: '',
  paymentPurpose: '',
  bik: '',
  correspondentAccount: '',
  recipientInn: '',
  recipientKpp: '',
  sbpLink: '',
}

function paymentRequestEventIds(request: ManualPaymentRequest): string[] {
  if (request.eventIds.length > 0) return request.eventIds
  return request.eventId
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildPlotLookup(plots: string[]): Set<string> {
  return new Set([...plots.map((plot) => plot.trim()).filter(Boolean), ...normalizePlots(plots)])
}

export function PaymentsSection({
  profile,
  paymentConfig,
  communityFunds,
  events,
  paymentRequests,
  balanceTone,
  balanceLabel,
  hasAnyPaymentDetails,
  paymentDetails,
  onOpenPaymentLink,
  onCopyAllPaymentDetails,
  onCopyDetail,
  onSubmitPaymentRequest,
  onSavePaymentConfig,
}: PaymentsSectionProps) {
  const isStaff = profile.role === 'ADMIN' || profile.role === 'MODERATOR'
  const hiddenChargeIds = useMemo(() => {
    const profilePlotLookup = buildPlotLookup(profile.plots.length > 0 ? profile.plots : [profile.plotName])
    const lockedChargeIds = new Set<string>()

    paymentRequests.forEach((request) => {
      if (request.status !== 'PENDING' && request.status !== 'CONFIRMED') return

      const requestPlotLookup = buildPlotLookup(request.plotIds.length > 0 ? request.plotIds : [request.plotName])
      const samePlot = Array.from(requestPlotLookup).some((plot) => profilePlotLookup.has(plot))
      if (!samePlot && request.userId !== profile.id) return

      paymentRequestEventIds(request).forEach((eventId) => lockedChargeIds.add(eventId))
    })

    return lockedChargeIds
  }, [paymentRequests, profile.id, profile.plotName, profile.plots])

  const availableCharges = useMemo(
    () => events.filter((item) => item.type === 'CHARGE' && !item.isClosed && !hiddenChargeIds.has(item.id)),
    [events, hiddenChargeIds],
  )
  const visibleDetails = useMemo(
    () => paymentDetails(paymentConfig).filter((item) => item.value.trim()),
    [paymentConfig, paymentDetails],
  )

  const [selectedChargeIds, setSelectedChargeIds] = useState<string[]>([])
  const [manualAmount, setManualAmount] = useState('')
  const [purpose, setPurpose] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')
  const [configExpanded, setConfigExpanded] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState('')
  const [configDraft, setConfigDraft] = useState<PaymentConfigDraft>(EMPTY_CONFIG)

  useEffect(() => {
    setConfigDraft({
      recipientName: paymentConfig.recipientName ?? '',
      recipientPhone: paymentConfig.recipientPhone ?? '',
      bankName: paymentConfig.bankName ?? '',
      accountNumber: paymentConfig.accountNumber ?? '',
      paymentPurpose: paymentConfig.paymentPurpose ?? '',
      bik: paymentConfig.bik ?? '',
      correspondentAccount: paymentConfig.correspondentAccount ?? '',
      recipientInn: paymentConfig.recipientInn ?? '',
      recipientKpp: paymentConfig.recipientKpp ?? '',
      sbpLink: paymentConfig.sbpLink ?? '',
    })
  }, [paymentConfig])

  useEffect(() => {
    const selectedCharges = availableCharges.filter((item) => selectedChargeIds.includes(item.id))
    if (selectedCharges.length === 0) return

    const amountPerPlot = selectedCharges.reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    const plotsCount = Math.max(profile.plots.length || 1, 1)
    setManualAmount(String(amountPerPlot * plotsCount))
    setPurpose(selectedCharges.map((item) => item.title).join(', '))
  }, [availableCharges, profile.plots.length, selectedChargeIds])

  useEffect(() => {
    const availableChargeIds = new Set(availableCharges.map((item) => item.id))
    setSelectedChargeIds((current) => {
      const nextSelectedChargeIds = current.filter((eventId) => availableChargeIds.has(eventId))
      return nextSelectedChargeIds.length === current.length ? current : nextSelectedChargeIds
    })
  }, [availableCharges])

  const resetPaymentFeedback = () => {
    if (formError) setFormError('')
    if (formSuccess) setFormSuccess('')
  }

  const toggleCharge = (eventId: string) => {
    resetPaymentFeedback()
    setSelectedChargeIds((current) =>
      current.includes(eventId) ? current.filter((id) => id !== eventId) : [...current, eventId],
    )
  }

  const handleSubmit = async () => {
    const amount = Number(manualAmount.replace(/[^\d]/g, ''))
    const selectedCharges = availableCharges.filter((item) => selectedChargeIds.includes(item.id))

    if (amount <= 0) {
      setFormSuccess('')
      setFormError('Укажите сумму перевода больше нуля.')
      return
    }

    if (!purpose.trim()) {
      setFormSuccess('')
      setFormError('Укажите назначение платежа.')
      return
    }

    setFormError('')
    setSubmitting(true)
    try {
      await onSubmitPaymentRequest(amount, selectedCharges, purpose.trim())
      setSelectedChargeIds([])
      setManualAmount('')
      setPurpose('')
      setFormSuccess('Заявка на оплату отправлена. Дождитесь подтверждения модератора или администратора.')
    } finally {
      setSubmitting(false)
    }
  }

  const updateConfigField = (field: keyof PaymentConfigDraft, value: string) => {
    setConfigDraft((current) => ({ ...current, [field]: value }))
    if (configError) setConfigError('')
  }

  const handleSaveConfig = async () => {
    if (!configDraft.paymentPurpose.trim()) {
      setConfigError('Укажите назначение платежа.')
      return
    }

    setConfigError('')
    setConfigSaving(true)
    try {
      await onSavePaymentConfig(configDraft)
      setConfigExpanded(false)
    } finally {
      setConfigSaving(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <p className="eyebrow accent">Раздел</p>
        <h2>Оплата</h2>
        <p>Общая сумма поселка, подтверждение переводов и банковские реквизиты для оплаты.</p>
      </div>

      <article className="balance-card">
        <span className="eyebrow accent-soft">Общая сумма поселка</span>
        <strong>{communityFunds.toLocaleString('ru-RU')} ₽</strong>
        <p>Текущее состояние общего фонда поселка.</p>
      </article>

      <article className={`balance-card ${balanceTone(profile.balance)}`}>
        <span className="eyebrow accent-soft">Ваш баланс</span>
        <strong>{profile.balance.toLocaleString('ru-RU')} ₽</strong>
        <p>{balanceLabel(profile.balance)}</p>
      </article>

      <div className="payment-request-card">
        <div className="panel-heading payment-request-card__heading">
          <h3>Я оплатил</h3>
          <p>Отправьте заявку, чтобы модератор или администратор подтвердил поступивший перевод.</p>
        </div>

        {availableCharges.length > 0 && (
          <div className="charge-picker">
            <p className="charge-picker__title">Выберите сбор</p>
            <div className="charge-picker__list">
              {availableCharges.map((item) => {
                const checked = selectedChargeIds.includes(item.id)
                return (
                  <label key={item.id} className={`charge-chip ${checked ? 'is-selected' : ''}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleCharge(item.id)} />
                    <span className="charge-chip__check" aria-hidden="true">
                      <span className="charge-chip__check-mark" />
                    </span>
                    <span className="charge-chip__title">{item.title}</span>
                    <strong>{item.amount.toLocaleString('ru-RU')} ₽</strong>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        <div className="payment-form-grid">
          <label>
            <span>Сумма перевода</span>
            <input
              value={manualAmount}
              onChange={(event) => {
                setManualAmount(event.target.value)
                resetPaymentFeedback()
              }}
              placeholder="Например, 1500"
              inputMode="numeric"
            />
          </label>

          <label>
            <span>Назначение платежа</span>
            <input
              value={purpose}
              onChange={(event) => {
                setPurpose(event.target.value)
                resetPaymentFeedback()
              }}
              placeholder="Например, За электричество"
            />
          </label>
        </div>

        {formError && <p className="error-note">{formError}</p>}
        {formSuccess && <p className="warning-note">{formSuccess}</p>}

        <button className="primary-button" type="button" onClick={() => void handleSubmit()} disabled={submitting}>
          {submitting ? 'Отправляем...' : 'Я оплатил'}
        </button>
      </div>

      {isStaff && (
        <div className="poll-create-card">
          <div className="poll-create-card__header">
            <div>
              <h3>Добавить реквизиты</h3>
              <p>Заполните или обновите банковские реквизиты, которые будут видны собственникам в разделе оплаты.</p>
            </div>
            <button className="ghost-button" type="button" onClick={() => setConfigExpanded((value) => !value)}>
              {configExpanded ? 'Свернуть' : 'Развернуть'}
            </button>
          </div>

          {configExpanded && (
            <div className="payment-form-grid">
              <label>
                <span>Получатель</span>
                <input value={configDraft.recipientName} onChange={(event) => updateConfigField('recipientName', event.target.value)} />
              </label>
              <label>
                <span>Телефон получателя</span>
                <input value={configDraft.recipientPhone} onChange={(event) => updateConfigField('recipientPhone', event.target.value)} />
              </label>
              <label>
                <span>Банк-получатель</span>
                <input value={configDraft.bankName} onChange={(event) => updateConfigField('bankName', event.target.value)} />
              </label>
              <label>
                <span>Номер счета</span>
                <input value={configDraft.accountNumber} onChange={(event) => updateConfigField('accountNumber', event.target.value)} />
              </label>
              <label className="payment-form-grid__wide">
                <span>Назначение платежа</span>
                <input value={configDraft.paymentPurpose} onChange={(event) => updateConfigField('paymentPurpose', event.target.value)} />
              </label>
              <label>
                <span>БИК</span>
                <input value={configDraft.bik} onChange={(event) => updateConfigField('bik', event.target.value)} />
              </label>
              <label>
                <span>Корр. счет</span>
                <input value={configDraft.correspondentAccount} onChange={(event) => updateConfigField('correspondentAccount', event.target.value)} />
              </label>
              <label>
                <span>ИНН</span>
                <input value={configDraft.recipientInn} onChange={(event) => updateConfigField('recipientInn', event.target.value)} />
              </label>
              <label>
                <span>КПП</span>
                <input value={configDraft.recipientKpp} onChange={(event) => updateConfigField('recipientKpp', event.target.value)} />
              </label>
              <label className="payment-form-grid__wide">
                <span>Ссылка на оплату</span>
                <input value={configDraft.sbpLink} onChange={(event) => updateConfigField('sbpLink', event.target.value)} />
              </label>
              {configError && <p className="error-note payment-form-grid__wide">{configError}</p>}
              <button className="primary-button payment-form-grid__wide" type="button" onClick={() => void handleSaveConfig()} disabled={configSaving}>
                {configSaving ? 'Сохраняем...' : 'Сохранить реквизиты'}
              </button>
            </div>
          )}
        </div>
      )}

      {hasAnyPaymentDetails(paymentConfig) && (
        <>
          <div className="payment-actions">
            <button className="primary-button" type="button" onClick={onOpenPaymentLink} disabled={!paymentConfig.sbpLink}>
              Открыть оплату в банке
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => void onCopyAllPaymentDetails()}
              disabled={visibleDetails.length === 0}
            >
              Скопировать все реквизиты
            </button>
          </div>

          <div className="details-grid">
            {visibleDetails.map((item) => (
              <article key={item.label} className="detail-card">
                <div className="detail-card__text">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
                <button className="copy-button" type="button" onClick={() => void onCopyDetail(item.value, item.label)}>
                  Копировать
                </button>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
