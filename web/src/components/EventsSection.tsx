import { useMemo, useState, type ChangeEvent } from 'react'
import type { CommunityEvent, EventType, RemoteUser } from '../types'

type EventTemplate = {
  name: string
  title: string
  message: string
  type: EventType
}

type EventsSectionProps = {
  profile: RemoteUser
  events: CommunityEvent[]
  formatDateTime: (value: number) => string
  labelForEventType: (event: CommunityEvent) => string
  onCreateEvent: (payload: { title: string; message: string; type: EventType; amount: number }) => void | Promise<void>
  onEditEvent: (event: CommunityEvent, payload: { title: string; message: string }) => void | Promise<void>
  onCloseCharge: (event: CommunityEvent) => void | Promise<void>
}

const DEFAULT_TEMPLATES: EventTemplate[] = [
  {
    name: 'Событие поселка',
    title: 'Скоро собрание',
    message:
      'Просьба всем собственникам принять участие в общем собрании в назначенное время. Обсудим текущие вопросы поселка и ближайшие расходы.',
    type: 'INFO',
  },
]

const CHARGE_TEMPLATES: EventTemplate[] = [
  {
    name: 'Нужды КП',
    title: 'Сбор средств на нужды КП',
    message: 'Проводится сбор средств на нужды коттеджного поселка. Просьба внести оплату в установленный срок.',
    type: 'CHARGE',
  },
]

const EXPENSE_TEMPLATES: EventTemplate[] = [
  {
    name: 'За электричество',
    title: 'Оплата за электричество',
    message:
      'Из общей суммы поселка проводится оплата за электричество. Средства списываются на покрытие текущих расходов по электроэнергии.',
    type: 'EXPENSE',
  },
  {
    name: 'Вывоз мусора',
    title: 'Оплата за вывоз мусора',
    message:
      'Из общей суммы поселка проводится оплата за вывоз мусора. Это обязательный расход для поддержания порядка на территории КП.',
    type: 'EXPENSE',
  },
  {
    name: 'Покос травы',
    title: 'Оплата за покос травы',
    message: 'Из общей суммы поселка проводится оплата за покос травы и обслуживание общей территории.',
    type: 'EXPENSE',
  },
  {
    name: 'Уборка снега',
    title: 'Оплата за уборку снега',
    message: 'Из общей суммы поселка проводится оплата за уборку снега и расчистку проездов внутри КП.',
    type: 'EXPENSE',
  },
  {
    name: 'Налоги',
    title: 'Оплата налогов',
    message: 'Из общей суммы поселка проводится оплата налогов и обязательных начислений.',
    type: 'EXPENSE',
  },
  {
    name: 'SIM карта',
    title: 'Оплата SIM-карты',
    message: 'Из общей суммы поселка проводится оплата SIM-карты для работы оборудования и сервисов поселка.',
    type: 'EXPENSE',
  },
]

function templatesForType(type: EventType) {
  if (type === 'CHARGE') return CHARGE_TEMPLATES
  if (type === 'EXPENSE') return EXPENSE_TEMPLATES
  if (type === 'INFO') return DEFAULT_TEMPLATES
  return []
}

export function EventsSection({
  profile,
  events,
  formatDateTime,
  labelForEventType,
  onCreateEvent,
  onEditEvent,
  onCloseCharge,
}: EventsSectionProps) {
  const isStaff = profile.role === 'ADMIN' || profile.role === 'MODERATOR'
  const [isCreateExpanded, setIsCreateExpanded] = useState(false)
  const [eventType, setEventType] = useState<EventType>('INFO')
  const [templateName, setTemplateName] = useState('')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const sortedEvents = useMemo(
    () => [...events].sort((left, right) => Number(right.createdAtClient ?? 0) - Number(left.createdAtClient ?? 0)),
    [events],
  )

  const templates = templatesForType(eventType)

  const applyTemplate = (selectedName: string) => {
    setTemplateName(selectedName)
    const selectedTemplate = templates.find((item) => item.name === selectedName)
    if (!selectedTemplate) return
    setTitle(selectedTemplate.title)
    setMessage(selectedTemplate.message)
    setFormError('')
  }

  const handleTypeChange = (nextType: EventType) => {
    setEventType(nextType)
    setTemplateName('')
    setTitle('')
    setMessage('')
    setAmount('')
    setFormError('')
  }

  const handleSubmit = async () => {
    const normalizedTitle = title.trim()
    const normalizedAmount = Number(amount.replace(/[^\d]/g, '')) || 0

    if (!normalizedTitle) {
      setFormError('Введите заголовок события')
      return
    }
    if ((eventType === 'CHARGE' || eventType === 'EXPENSE') && normalizedAmount <= 0) {
      setFormError(eventType === 'CHARGE' ? 'Для сбора нужна сумма больше нуля' : 'Для оплаты нужна сумма больше нуля')
      return
    }

    setFormError('')
    setSubmitting(true)
    try {
      await onCreateEvent({
        title: normalizedTitle,
        message,
        type: eventType,
        amount: normalizedAmount,
      })
      setTemplateName('')
      setTitle('')
      setMessage('')
      setAmount('')
      setEventType('INFO')
      setIsCreateExpanded(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = async (event: CommunityEvent) => {
    const nextTitle = window.prompt('Новый заголовок', event.title)
    if (nextTitle === null) return
    const nextMessage = window.prompt('Новое описание', event.message)
    if (nextMessage === null) return
    await onEditEvent(event, { title: nextTitle, message: nextMessage })
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <p className="eyebrow accent">Раздел</p>
        <h2>Объявления и события</h2>
        <p>Все важные новости поселка, сборы и оплаты из общей кассы.</p>
      </div>

      {isStaff && (
        <div className="poll-create-card">
          <div className="poll-create-card__header">
            <div>
              <h3>События и уведомления</h3>
              <p>Публикуйте уведомления, создавайте сборы и фиксируйте оплаты из общей кассы.</p>
            </div>
            <button className="ghost-button" type="button" onClick={() => setIsCreateExpanded((value) => !value)}>
              {isCreateExpanded ? 'Свернуть' : 'Развернуть'}
            </button>
          </div>

          {isCreateExpanded && (
            <div className="poll-create">
              <div className="event-choice-list" role="radiogroup" aria-label="Тип события">
                {([
                  { value: 'INFO', label: 'Просто уведомление' },
                  { value: 'CHARGE', label: 'Сбор средств' },
                  { value: 'EXPENSE', label: 'Оплата' },
                ] as const).map((item) => {
                  const selected = eventType === item.value
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`event-choice ${selected ? 'is-selected' : ''}`}
                      onClick={() => handleTypeChange(item.value)}
                    >
                      <span className="event-choice-dot" aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </div>

              {templates.length > 0 && (
                <label className="event-template-field">
                  <span>Шаблон сообщения</span>
                  <select value={templateName} onChange={(event) => applyTemplate(event.target.value)}>
                    <option value="">Выберите шаблон</option>
                    {templates.map((template) => (
                      <option key={template.name} value={template.name}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <input
                value={title}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  setTitle(event.target.value)
                  if (formError) setFormError('')
                }}
                placeholder="Заголовок события"
              />
              <textarea
                value={message}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setMessage(event.target.value)}
                placeholder="Описание события"
                rows={3}
              />
              {(eventType === 'CHARGE' || eventType === 'EXPENSE') && (
                <input
                  value={amount}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    setAmount(event.target.value)
                    if (formError) setFormError('')
                  }}
                  placeholder={eventType === 'CHARGE' ? 'Сумма сбора' : 'Сумма оплаты'}
                  inputMode="numeric"
                />
              )}
              {formError && <p className="error-note">{formError}</p>}
              <button className="primary-button" type="button" onClick={() => void handleSubmit()} disabled={submitting}>
                {submitting ? 'Публикуем...' : 'Опубликовать событие'}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="stack">
        {sortedEvents.length === 0 ? (
          <div className="chat-empty-inline">Пока нет объявлений для веб-кабинета.</div>
        ) : (
          sortedEvents.map((item) => {
            const canCloseCharge = item.type === 'CHARGE' && !item.isClosed && isStaff

            return (
              <article key={item.id} className={`event-card event-${item.type.toLowerCase()}`}>
                <div className="event-meta">
                  <span className="event-badge">{labelForEventType(item)}</span>
                  <span>{formatDateTime(item.createdAtClient)}</span>
                </div>
                <h3>{item.title}</h3>
                {item.message.trim() && <p>{item.message}</p>}
                {item.amount > 0 && <strong className="event-amount">{item.amount.toLocaleString('ru-RU')} ₽</strong>}
                {item.createdByName && <p className="hero-copy compact">Создал: {item.createdByName}</p>}
                {isStaff && (
                  <div className="chat-actions-inline">
                    <button className="ghost-button" type="button" onClick={() => void handleEdit(item)}>
                      Редактировать
                    </button>
                    {canCloseCharge && (
                      <button className="ghost-button" type="button" onClick={() => void onCloseCharge(item)}>
                        Закрыть сбор
                      </button>
                    )}
                  </div>
                )}
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}
