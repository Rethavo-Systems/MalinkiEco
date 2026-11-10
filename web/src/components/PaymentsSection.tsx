import { useCurrentTime } from '../hooks/useCurrentTime'
import { isChargeClosed } from '../lib/chargeDeadline'
import { useEffect, useMemo, useState } from 'react'
import { reservedChargeIds, parsePaymentRubles } from '../lib/paymentSelection'
import { normalizePlots } from '../lib/plotAccounts'
import type { CommunityEvent, ManualPaymentRequest, PaymentTransferConfig, RemoteUser } from '../types'
import './PaymentDetails.css'

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
  onSubmitPaymentRequest: (amount: number, events: CommunityEvent[], purpose: string, plots: string[]) => void | Promise<void>
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
  const profilePlots = normalizePlots(profile.plots.length ? profile.plots : [profile.plotName])
  const [chosenPlots, setChosenPlots] = useState<string[] | null>(null)
  const paymentPlots = chosenPlots === null ? profilePlots : chosenPlots.filter(plot => profilePlots.includes(plot))
  const paymentPlotKey = paymentPlots.join('|')
  const hiddenChargeIds = useMemo(() => reservedChargeIds(paymentPlotKey.split('|').filter(Boolean), paymentRequests.map(request => ({
    status: request.status,
    plots: normalizePlots(request.plotIds.length ? request.plotIds : request.plotName.split(',')),
    eventIds: paymentRequestEventIds(request),
  }))), [paymentRequests, paymentPlotKey])

  const now = useCurrentTime()
  const availableCharges = useMemo(() => {
    return events.filter(
      (item) => item.type === 'CHARGE' && !isChargeClosed(item, now) && !hiddenChargeIds.has(item.id),
    )
  }, [events, hiddenChargeIds, now])
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
    const plotsCount = paymentPlotKey.split('|').filter(Boolean).length
    setManualAmount(String(amountPerPlot * plotsCount))
    setPurpose(selectedCharges.map((item) => item.title).join(', '))
  }, [availableCharges, paymentPlotKey, selectedChargeIds])

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
    const amount = parsePaymentRubles(manualAmount)
    const selectedCharges = availableCharges.filter((item) => selectedChargeIds.includes(item.id))

    if (paymentPlots.length === 0) {
      setFormError('Выберите участок, за который перевели деньги.')
      return
    }
    if (amount === null) {
      setFormSuccess('')
      setFormError('Укажите сумму перевода в целых рублях больше нуля.')
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
      await onSubmitPaymentRequest(amount, selectedCharges, purpose.trim(), paymentPlots)
      setSelectedChargeIds([])
      setManualAmount('')
      setPurpose('')
      setFormSuccess('Заявка на оплату отправлена. Дождитесь подтверждения модератора или администратора.')
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Не удалось отправить заявку. Попробуйте ещё раз.')
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
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : 'Не удалось сохранить реквизиты.')
    } finally {
      setConfigSaving(false)
    }
  }

  return (
    <section className="panel payments-section">
      <div className="panel-heading">
        <p className="eyebrow accent">Раздел</p>
        <h2>Оплата</h2>
        <p>Общая сумма поселка, подтверждение переводов и банковские реквизиты для оплаты.</p>
      </div>

      <div className="payment-summary">
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

      </div>

      {profilePlots.length > 0 ? <div className="payment-request-card">
        <div className="panel-heading payment-request-card__heading">
          <h3>Я оплатил</h3>
          <p>Отправьте заявку, чтобы модератор или администратор подтвердил поступивший перевод.</p>
        </div>

        {profilePlots.length > 1 && <fieldset className="payment-plot-picker">
          <legend>За какие участки перевели деньги?</legend>
          {profilePlots.map(plot => <label key={plot}>
            <input type="checkbox" checked={paymentPlots.includes(plot)} disabled={submitting} onChange={() => {
              setChosenPlots(paymentPlots.includes(plot) ? paymentPlots.filter(value => value !== plot) : [...paymentPlots, plot])
              setSelectedChargeIds([])
              setManualAmount('')
              setPurpose('')
              resetPaymentFeedback()
            }} />{plot}
          </label>)}
          <p>Сумма распределится между выбранными участками. Если по сбору уже есть заявка для одного из них, выберите только оставшиеся участки.</p>
        </fieldset>}

        {availableCharges.length > 0 && (
          <div className="charge-picker">
            <p className="charge-picker__title">Выберите сбор</p>
            <div className="charge-picker__list">
              {availableCharges.map((item) => {
                const checked = selectedChargeIds.includes(item.id)
                return (
                  <label key={item.id} className={`charge-chip ${checked ? 'is-selected' : ''}`}>
                    <input type="checkbox" checked={checked} disabled={submitting || paymentPlots.length === 0} onChange={() => toggleCharge(item.id)} />
                    <span className="charge-chip__check" aria-hidden="true">
                      <span className="charge-chip__check-mark" />
                    </span>
                    <span className="charge-chip__title">{item.title}</span>
                    <strong>{item.amount.toLocaleString('ru-RU')} ₽ <small>за участок</small></strong>
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
      </div> : <p className="payment-plot-note">К этому аккаунту не привязаны участки. Заявка «Я оплатил» доступна владельцам участков.</p>}

      {isStaff && (
        <div className="poll-create-card payment-config-card">
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
            <div className="payment-form-grid payment-config-grid">
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

          <div className="details-grid payment-details-grid">
            {visibleDetails.map((item) => (
              <article key={item.label} className="detail-card payment-detail-card">
                <div className="detail-card__text">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
                <button className="copy-button" type="button" aria-label={`Скопировать: ${item.label}`} onClick={() => void onCopyDetail(item.value, item.label)}>
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
