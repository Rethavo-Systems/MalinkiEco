export type FormattedPart = { text: string } | { style: 'strong' | 'em' | 'u' | 's' | 'code'; children: FormattedPart[] }
export const chatFormats = [
  { label: 'Жирный', mark: '**', icon: 'B', shortcut: 'B' },
  { label: 'Курсив', mark: '_', icon: 'I', shortcut: 'I' },
  { label: 'Подчёркнутый', mark: '__', icon: 'U', shortcut: 'U' },
  { label: 'Зачёркнутый', mark: '~~', icon: 'S', shortcut: '' },
  { label: 'Моноширинный', mark: '`', icon: '<>', shortcut: '' },
] as const

/** A deliberately small text-only grammar: never interprets HTML or URLs. */
export function parseChatFormatting(text: string, depth = 0): FormattedPart[] {
  if (depth > 8) return [{ text }]
  const pattern = /\*\*([^\n]+?)\*\*|__([^\n]+?)__|~~([^\n]+?)~~|`([^`\n]+)`|_([^_\n]+)_/g
  const result: FormattedPart[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index! > cursor) result.push({ text: text.slice(cursor, match.index) })
    const group = match.slice(1).findIndex(value => value !== undefined)
    const style = (['strong', 'u', 's', 'code', 'em'] as const)[group]
    const content = match[group + 1]
    result.push({ style, children: style === 'code' ? [{ text: content }] : parseChatFormatting(content, depth + 1) })
    cursor = match.index! + match[0].length
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor) })
  return result
}

export function formatChatSelection(text: string, start: number, end: number, mark: string) {
  if (start === end) return { text, start, end }
  if (text.slice(Math.max(0, start - mark.length), start) === mark && text.slice(end, end + mark.length) === mark) {
    return { text: text.slice(0, start - mark.length) + text.slice(start, end) + text.slice(end + mark.length), start: start - mark.length, end: end - mark.length }
  }
  return { text: text.slice(0, start) + mark + text.slice(start, end) + mark + text.slice(end), start: start + mark.length, end: end + mark.length }
}
