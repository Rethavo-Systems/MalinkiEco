import { useMemo, useRef, useState, type FormEvent } from 'react'
import { formatPlots } from '../utils'
import type { CommunityEvent, PollDraft, RemoteUser } from '../types'
import './PollsSection.css'

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

function voteCountLabel(count: number) {
  const ending = new Intl.PluralRules('ru').select(count)
  return `${count} ${ending === 'one' ? 'голос' : ending === 'few' ? 'голоса' : 'голосов'}`
}

export function PollsSection({
  profile, users, pollDraft, pollSubmitting, polls,
  onFieldChange, onSubmit, onVote, onClosePoll, formatDateTime,
}: PollsSectionProps) {
  const [creating, setCreating] = useState(false)
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const [formError, setFormError] = useState('')
  const [busyPoll, setBusyPoll] = useState('')
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null)
  const [resultsPollId, setResultsPollId] = useState('')
  const resultsDialog = useRef<HTMLDialogElement>(null)
  const optionInputs = pollDraft.options.split('\n')
  while (optionInputs.length < 2) optionInputs.push('')

  // Completed polls stay in the feed, including the community's original poll.
  const sortedPolls = useMemo(() => [...polls].sort((a, b) =>
    Number(a.isClosed) - Number(b.isClosed) || b.createdAtClient - a.createdAtClient), [polls])
  const resultsPoll = polls.find(poll => poll.id === resultsPollId)
  const labels = useMemo(() => new Map(users.map(user => [user.id,
    { name: user.fullName, plots: formatPlots(user) }])), [users])

  const updateOptions = (options: string[]) => {
    onFieldChange('options', options.join('\n'))
    setFormError('')
  }
  const runAction = async (poll: CommunityEvent, action: () => void | Promise<void>) => {
    if (busyPoll) return
    setBusyPoll(poll.id)
    setActionError(null)
    try { await action() }
    catch (error) { setActionError({ id: poll.id, message: error instanceof Error ? error.message : 'Не удалось сохранить. Попробуйте ещё раз.' }) }
    finally { setBusyPoll('') }
  }
  const createPoll = async (event: FormEvent) => {
    event.preventDefault()
    if (pollSubmitting) return
    const options = pollDraft.options.split('\n').map(value => value.trim()).filter(Boolean)
    if (!pollDraft.title.trim()) { setFormError('Напишите вопрос.'); return }
    if (options.length < 2 || options.length > 8 || new Set(options.map(value => value.toLowerCase())).size !== options.length) {
      setFormError('Добавьте от 2 до 8 разных вариантов ответа.'); return
    }
    setFormError('')
    try {
      await onSubmit()
      setCreating(false)
      setDescriptionOpen(false)
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Не удалось создать опрос.') }
  }

  return <section className="panel messenger-polls">
    <div className="messenger-polls__content">
      <header className="messenger-polls__header">
        <h2>Опросы</h2>
        {!creating && <button className="messenger-polls__create-button" type="button" onClick={() => setCreating(true)}>
          <span aria-hidden="true">＋</span> Создать опрос
        </button>}
      </header>

      {creating && <form className="messenger-poll-compose" onSubmit={event => void createPoll(event)}>
        <fieldset disabled={pollSubmitting}>
          <legend>Новый опрос</legend>
          <label className="messenger-poll-compose__field">
            <span>Вопрос</span>
            <input autoFocus aria-label="Вопрос опроса" placeholder="Что хотите спросить?" value={pollDraft.title}
              onChange={event => { onFieldChange('title', event.target.value); setFormError('') }} />
          </label>
          <div className="messenger-poll-compose__field">
            <span>Варианты ответа</span>
            <div className="messenger-poll-compose__options">
              {optionInputs.map((option, index) => <div className="messenger-poll-compose__option" key={index}>
                <span aria-hidden="true" className="messenger-poll-compose__dot" />
                <input aria-label={`Вариант ответа ${index + 1}`} placeholder={`Вариант ${index + 1}`} value={option}
                  onChange={event => updateOptions(optionInputs.map((value, position) => position === index ? event.target.value : value))} />
                {optionInputs.length > 2 && <button type="button" aria-label={`Удалить вариант ${index + 1}`}
                  onClick={() => updateOptions(optionInputs.filter((_, position) => position !== index))}>×</button>}
              </div>)}
            </div>
            {optionInputs.length < 8 && <button className="messenger-polls__text-button" type="button" onClick={() => updateOptions([...optionInputs, ''])}>＋ Добавить вариант</button>}
          </div>
          {descriptionOpen || pollDraft.message ? <label className="messenger-poll-compose__field">
            <span>Описание <small>необязательно</small></span>
            <textarea rows={2} aria-label="Описание опроса" placeholder="Уточните детали" value={pollDraft.message}
              onChange={event => onFieldChange('message', event.target.value)} />
          </label> : <button className="messenger-polls__text-button" type="button" onClick={() => setDescriptionOpen(true)}>Добавить описание</button>}
          <div className="messenger-poll-compose__anonymous">
            <span><strong id="anonymous-poll-label">Анонимное голосование</strong><small id="anonymous-poll-description">Имена проголосовавших будут скрыты</small></span>
            <button type="button" className="messenger-poll-compose__switch" role="switch" aria-checked={pollDraft.isAnonymous}
              aria-labelledby="anonymous-poll-label" aria-describedby="anonymous-poll-description"
              onClick={() => onFieldChange('isAnonymous', !pollDraft.isAnonymous)}><span aria-hidden="true" /></button>
          </div>
          {formError && <p role="alert" className="error-note">{formError}</p>}
          <div className="messenger-poll-compose__actions">
            <button type="button" className="messenger-polls__text-button" onClick={() => { setCreating(false); setFormError('') }}>Отмена</button>
            <button type="submit" className="primary-button">{pollSubmitting ? 'Создаём…' : 'Создать опрос'}</button>
          </div>
        </fieldset>
      </form>}

      <div className="messenger-polls__feed">
        {sortedPolls.length === 0 && <div className="messenger-polls__empty"><strong>Пока нет опросов</strong><p>Создайте первый, чтобы узнать мнение соседей.</p></div>}
        {sortedPolls.map(poll => {
          const hasVoted = poll.voterIds.includes(profile.id)
          const canSeeResults = poll.isClosed || hasVoted
          const canClose = !poll.isClosed && (poll.createdById === profile.id || ['ADMIN','MODERATOR'].includes(profile.role))
          const total = poll.voterIds.length
          return <article className="messenger-poll" key={poll.id}>
            <h3>{poll.title}</h3>
            <p className="messenger-poll__author">Создал: {poll.createdByName || labels.get(poll.createdById)?.name || 'Участник'}</p>
            <p className="messenger-poll__kind">{poll.isAnonymous ? 'Анонимный опрос' : 'Открытый опрос'}{poll.isClosed ? ' · Завершён' : hasVoted ? ' · Вы проголосовали' : ' · Выберите один ответ'}</p>
            {poll.message.trim() && <p className="messenger-poll__description">{poll.message}</p>}
            <div className="messenger-poll__options" aria-label={`Варианты ответа: ${poll.title}`}>
              {poll.pollOptions.map(option => {
                const selected = poll.voterChoices[profile.id] === option
                const percent = total ? Math.max(0, Math.min(100, Math.round(Number(poll.pollVotes[option] ?? 0) / total * 100))) : 0
                return <button type="button" key={option} className={`messenger-poll__option${canSeeResults ? ' has-result' : ''}${selected ? ' is-selected' : ''}`}
                  disabled={canSeeResults || Boolean(busyPoll)} aria-pressed={selected}
                  aria-label={canSeeResults ? `${option} — ${percent}%, ${voteCountLabel(Number(poll.pollVotes[option] ?? 0))}` : option}
                  onClick={() => void runAction(poll, () => onVote(poll, option))}>
                  <span className="messenger-poll__option-mark" aria-hidden="true">{canSeeResults ? `${percent}%` : <span className="messenger-poll__radio" />}</span>
                  <span className="messenger-poll__option-content"><span>{option}{selected && <span className="messenger-poll__chosen" aria-label="Ваш ответ"> ✓</span>}</span>
                    {canSeeResults && <span className="messenger-poll__bar-track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>}
                  </span>
                </button>
              })}
            </div>
            {actionError?.id === poll.id && <p role="alert" className="error-note">{actionError.message}</p>}
            <footer className="messenger-poll__footer">
              {canSeeResults && !poll.isAnonymous && total > 0
                ? <button type="button" className="messenger-polls__text-button" onClick={() => setResultsPollId(poll.id)} aria-label={`Кто проголосовал: ${poll.title}`}>{voteCountLabel(total)}<span aria-hidden="true"> ›</span></button>
                : <span>{busyPoll === poll.id ? 'Сохраняем голос…' : voteCountLabel(total)}</span>}
              <span className="messenger-poll__date">{formatDateTime(poll.createdAtClient)}</span>
            </footer>
            {canClose && <details className="messenger-poll__manage">
              <summary>Управление опросом</summary>
              <button type="button" className="messenger-polls__text-button" disabled={Boolean(busyPoll)} onClick={() => {
                if (window.confirm('Завершить опрос? Новые голоса больше не будут приниматься.')) void runAction(poll, () => onClosePoll(poll))
              }}>Завершить опрос</button>
            </details>}
          </article>
        })}
      </div>
    </div>
    {resultsPoll && !resultsPoll.isAnonymous && (resultsPoll.isClosed || resultsPoll.voterIds.includes(profile.id)) && <dialog className="messenger-poll-results" aria-label="Кто проголосовал"
      ref={element => { resultsDialog.current = element; if (element && !element.open) element.showModal() }}
      onClose={() => setResultsPollId('')} onClick={event => { if (event.target === event.currentTarget) resultsDialog.current?.close() }}>
      <header><div><h3>Кто проголосовал</h3><p>{resultsPoll.title}</p></div><button type="button" aria-label="Закрыть список голосов" onClick={() => resultsDialog.current?.close()}>×</button></header>
      <div className="messenger-poll-results__body">{resultsPoll.pollOptions.map(option => {
        const voters = resultsPoll.voterIds.filter(id => resultsPoll.voterChoices[id] === option)
        return <section key={option}><h4>{option} <span>{voters.length}</span></h4>
          {voters.length ? <ul>{voters.map(id => <li key={id}><strong>{labels.get(id)?.name || 'Участник без профиля'}</strong><span>{labels.get(id)?.plots}</span></li>)}</ul> : <p>Пока нет голосов</p>}
        </section>
      })}</div>
    </dialog>}
  </section>
}
