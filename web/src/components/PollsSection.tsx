import { useMemo, useState, type ChangeEvent } from 'react'
import { formatPlots } from '../utils'
import type { CommunityEvent, PollDraft, RemoteUser } from '../types'

type PollsSectionProps = {
  profile: RemoteUser
  users: RemoteUser[]
  pollDraft: PollDraft
  pollSubmitting: boolean
  polls: CommunityEvent[]
  onFieldChange: (field: keyof PollDraft, value: string | boolean) => void
  onSubmit: () => void | Promise<void>
  onVote: (poll: CommunityEvent, option: string) => void | Promise<void>
  onClosePoll: (poll: CommunityEvent) => void | Promise<void>
  formatDateTime: (value: number) => string
}

export function PollsSection({
  profile,
  users,
  pollDraft,
  pollSubmitting,
  polls,
  onFieldChange,
  onSubmit,
  onVote,
  onClosePoll,
  formatDateTime,
}: PollsSectionProps) {
  const [isCreateExpanded, setIsCreateExpanded] = useState(false)
  const [formError, setFormError] = useState('')
  const [expandedResults, setExpandedResults] = useState<Record<string, boolean>>({})

  const userLabelById = useMemo(
    () =>
      users.reduce<Record<string, string>>((accumulator, user) => {
        if (user.id) {
          const plotsLabel = formatPlots(user)
          accumulator[user.id] = plotsLabel ? `${user.fullName} — ${plotsLabel}` : user.fullName
        }
        return accumulator
      }, {}),
    [users],
  )

  const sortedPolls = useMemo(
    () => [...polls].sort((left, right) => Number(right.createdAtClient ?? 0) - Number(left.createdAtClient ?? 0)),
    [polls],
  )

  const toggleResults = (pollId: string) => {
    setExpandedResults((current) => ({ ...current, [pollId]: !current[pollId] }))
  }

  const resolveVotersByOption = (poll: CommunityEvent) => {
    return poll.pollOptions.reduce<Record<string, string[]>>((accumulator, option) => {
      const voters = poll.voterIds
        .filter((userId) => poll.voterChoices[userId] === option)
        .map((userId) => userLabelById[userId] || `Участник ${userId}`)
      accumulator[option] = voters
      return accumulator
    }, {})
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <p className="eyebrow accent">Раздел</p>
        <h2>Опросы</h2>
        <p>Здесь можно голосовать и создавать опросы для жителей прямо в веб-версии.</p>
      </div>

      <div className="poll-create-card">
        <div className="poll-create-card__header">
          <div>
            <h3>Создать опрос</h3>
            <p>Новый опрос появится в общей ленте сразу после публикации.</p>
          </div>
          <button className="ghost-button" type="button" onClick={() => setIsCreateExpanded((current) => !current)}>
            {isCreateExpanded ? 'Свернуть' : 'Развернуть'}
          </button>
        </div>

        {isCreateExpanded && (
          <div className="poll-create">
            <input
              value={pollDraft.title}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                onFieldChange('title', event.target.value)
                if (formError) setFormError('')
              }}
              placeholder="Заголовок опроса"
            />
            <textarea
              value={pollDraft.message}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onFieldChange('message', event.target.value)}
              placeholder="Описание опроса"
              rows={3}
            />
            <textarea
              value={pollDraft.options}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                onFieldChange('options', event.target.value)
                if (formError) setFormError('')
              }}
              placeholder={'Варианты ответов, каждый с новой строки\nДа\nНет'}
              rows={4}
            />

            <label className="poll-anonymous-toggle" htmlFor="poll-anonymous">
              <input
                id="poll-anonymous"
                type="checkbox"
                checked={pollDraft.isAnonymous}
                onChange={(event) => onFieldChange('isAnonymous', event.target.checked)}
              />
              <span className="poll-anonymous-toggle__track" aria-hidden="true">
                <span className="poll-anonymous-toggle__thumb" />
              </span>
              <span className="poll-anonymous-toggle__label">Анонимный опрос</span>
            </label>

            {formError && <p className="error-note">{formError}</p>}
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                if (!pollDraft.title.trim()) {
                  setFormError('Введите заголовок опроса.')
                  return
                }
                const options = pollDraft.options
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean)
                if (options.length < 2) {
                  setFormError('Добавьте минимум два варианта ответа.')
                  return
                }
                setFormError('')
                void onSubmit()
              }}
              disabled={pollSubmitting}
            >
              {pollSubmitting ? 'Создаем...' : 'Создать опрос'}
            </button>
          </div>
        )}
      </div>

      <div className="stack">
        {sortedPolls.length === 0 ? (
          <div className="chat-empty-inline">Сейчас нет активных опросов.</div>
        ) : (
          sortedPolls.map((poll) => {
            const hasVoted = poll.voterIds.includes(profile.id)
            const canClosePoll =
              !poll.isClosed && (poll.createdById === profile.id || profile.role === 'MODERATOR' || profile.role === 'ADMIN')
            const canSeeResults = poll.isClosed || hasVoted
            const showResults = Boolean(expandedResults[poll.id]) && canSeeResults
            const votersByOption = resolveVotersByOption(poll)
            const totalVotes = poll.voterIds.length

            return (
              <article key={poll.id} className="poll-card">
                <div className="poll-card__header">
                  <div className="event-meta">
                    <span className="event-badge">{poll.isClosed ? 'Опрос закрыт' : 'Опрос активен'}</span>
                    <span>{formatDateTime(poll.createdAtClient)}</span>
                  </div>
                  <div className="chat-actions-inline">
                    <button className="ghost-button" type="button" onClick={() => toggleResults(poll.id)} disabled={!canSeeResults}>
                      {canSeeResults ? (showResults ? 'Скрыть результаты' : 'Результаты') : 'Результаты после голосования'}
                    </button>
                    {canClosePoll && (
                      <button className="ghost-button" type="button" onClick={() => void onClosePoll(poll)}>
                        Закрыть опрос
                      </button>
                    )}
                  </div>
                </div>

                <h3>{poll.title}</h3>
                {poll.message.trim() && <p>{poll.message}</p>}
                {poll.createdByName && <p className="hero-copy compact">Создал: {poll.createdByName}</p>}

                <div className="poll-options">
                  {poll.pollOptions.map((option) => (
                    <button
                      key={option}
                      className={`poll-option ${poll.voterChoices[profile.id] === option ? 'is-selected' : ''}`}
                      disabled={hasVoted || poll.isClosed}
                      onClick={() => void onVote(poll, option)}
                    >
                      <span>{option}</span>
                      <strong>{canSeeResults ? poll.pollVotes[option] ?? 0 : '•'}</strong>
                    </button>
                  ))}
                </div>

                {showResults && (
                  <div className="poll-results">
                    <p className="hero-copy compact">Всего голосов: {totalVotes}</p>
                    {poll.isAnonymous ? (
                      <div className="stack">
                        {poll.pollOptions.map((option) => (
                          <div key={option} className="detail-card">
                            <div className="detail-card__text">
                              <span>{option}</span>
                              <strong>{poll.pollVotes[option] ?? 0}</strong>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="stack">
                        {poll.pollOptions.map((option) => (
                          <div key={option} className="detail-card">
                            <div className="detail-card__text">
                              <span>{option}</span>
                              <strong>{poll.pollVotes[option] ?? 0}</strong>
                              <span>
                                {votersByOption[option].length > 0
                                  ? votersByOption[option].join(', ')
                                  : 'Пока никто не голосовал'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
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
