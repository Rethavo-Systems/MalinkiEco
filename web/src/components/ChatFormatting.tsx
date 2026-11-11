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
  persistentToolbar?: boolean
  formattingContext?: string
}

export function ChatFormatInput({ value, onValueChange, textareaRef, onKeyDown, persistentToolbar = false, formattingContext = '', ...props }: Props) {
  const ownRef = useRef<HTMLTextAreaElement>(null)
  const ref = textareaRef ?? ownRef
  const [selectedRange, setSelection] = useState<{ start: number; end: number; context: string } | null>(null)
  const [previewContext, setPreviewContext] = useState<string | null>(null)
  const selection = selectedRange?.context === formattingContext ? selectedRange : null
  const apply = (mark: string) => {
    const input = ref.current
    if (!input || props.readOnly || props.disabled) return
    const range = selection ?? { start: input.selectionStart, end: input.selectionEnd }
    if (range.start === range.end) return
    const next = formatChatSelection(value, range.start, range.end, mark)
    onValueChange(next.text)
    setSelection({ start: next.start, end: next.end, context: formattingContext })
    setPreviewContext(formattingContext)
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(next.start, next.end) })
  }
  return <div className="chat-format-input">
    {(selection || persistentToolbar) && <div className={`chat-format-toolbar${persistentToolbar ? ' is-persistent' : ''}`} role="toolbar" aria-label="Форматирование выделенного текста" onMouseDown={event => event.preventDefault()} onPointerDown={event => { if (persistentToolbar) event.preventDefault() }}>
      {chatFormats.map(format => <button key={format.mark} type="button" title={format.label} aria-label={format.label} disabled={!selection || props.readOnly || props.disabled} onClick={() => apply(format.mark)}><span className={`format-${format.label}`}>{format.icon}</span></button>)}
    </div>}
    <textarea {...props} ref={ref} value={value}
      onSelect={event => { const { selectionStart: start, selectionEnd: end } = event.currentTarget; setSelection(start !== end ? { start, end, context: formattingContext } : null) }}
      onBlur={event => { if (!event.relatedTarget?.closest('.chat-format-toolbar')) setSelection(null) }}
      onContextMenu={event => { const input = event.currentTarget; if (input.selectionStart !== input.selectionEnd) { event.preventDefault(); event.stopPropagation(); setSelection({ start: input.selectionStart, end: input.selectionEnd, context: formattingContext }) } }}
      onChange={event => { onValueChange(event.target.value); event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px` }}
      onKeyDown={event => {
        const format = chatFormats.find(item => item.shortcut.toLowerCase() === event.key.toLowerCase())
        if ((event.ctrlKey || event.metaKey) && format && event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) { event.preventDefault(); apply(format.mark); return }
        if (event.key === 'Escape') {
          setSelection(null)
          setPreviewContext(null)
          if (!persistentToolbar) return
        }
        onKeyDown?.(event)
      }} />
    {previewContext === formattingContext && value && <div className="chat-format-preview"><small>Предпросмотр</small><div><ChatFormattedText text={value} /></div></div>}
  </div>
}
