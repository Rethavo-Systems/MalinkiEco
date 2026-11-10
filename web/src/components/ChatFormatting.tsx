import { createElement, useRef, useState, type TextareaHTMLAttributes, type RefObject } from 'react'
import { chatFormats, formatChatSelection, parseChatFormatting, type FormattedPart } from '../lib/chatFormatting'

function renderParts(parts: FormattedPart[]): React.ReactNode[] {
  return parts.map((part, index) => 'text' in part ? part.text : createElement(part.style, { key: index }, renderParts(part.children)))
}
export function ChatFormattedText({ text }: { text: string }) { return <>{renderParts(parseChatFormatting(text))}</> }

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (text: string) => void
  textareaRef?: RefObject<HTMLTextAreaElement | null>
}

export function ChatFormatInput({ value, onValueChange, textareaRef, onKeyDown, ...props }: Props) {
  const ownRef = useRef<HTMLTextAreaElement>(null)
  const ref = textareaRef ?? ownRef
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const apply = (mark: string) => {
    const input = ref.current
    if (!input) return
    const range = selection ?? { start: input.selectionStart, end: input.selectionEnd }
    const next = formatChatSelection(value, range.start, range.end, mark)
    onValueChange(next.text)
    setShowPreview(true)
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(next.start, next.end) })
  }
  return <div className="chat-format-input">
    {selection && <div className="chat-format-toolbar" role="toolbar" aria-label="Форматирование выделенного текста" onMouseDown={event => event.preventDefault()}>
      {chatFormats.map(format => <button key={format.mark} type="button" title={format.label} aria-label={format.label} onClick={() => apply(format.mark)}><span className={`format-${format.label}`}>{format.icon}</span></button>)}
    </div>}
    <textarea {...props} ref={ref} value={value}
      onSelect={event => { const { selectionStart: start, selectionEnd: end } = event.currentTarget; setSelection(start !== end ? { start, end } : null) }}
      onBlur={event => { if (!event.relatedTarget?.closest('.chat-format-toolbar')) setSelection(null) }}
      onContextMenu={event => { const input = event.currentTarget; if (input.selectionStart !== input.selectionEnd) { event.preventDefault(); event.stopPropagation(); setSelection({ start: input.selectionStart, end: input.selectionEnd }) } }}
      onChange={event => { onValueChange(event.target.value); event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px` }}
      onKeyDown={event => {
        const format = chatFormats.find(item => item.shortcut.toLowerCase() === event.key.toLowerCase())
        if ((event.ctrlKey || event.metaKey) && format && event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) { event.preventDefault(); apply(format.mark); return }
        if (event.key === 'Escape') { setSelection(null); setShowPreview(false); return }
        onKeyDown?.(event)
      }} />
    {showPreview && value && <div className="chat-format-preview"><small>Предпросмотр</small><div><ChatFormattedText text={value} /></div></div>}
  </div>
}
