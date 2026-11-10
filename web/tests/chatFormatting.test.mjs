import test from 'node:test'
import assert from 'node:assert/strict'
import { parseChatFormatting, formatChatSelection } from '../src/lib/chatFormatting.ts'

test('formats selected text and toggles markers without losing surrounding text', () => {
  const formatted = formatChatSelection('Привет соседи!', 7, 13, '**')
  assert.equal(formatted.text, 'Привет **соседи**!')
  assert.deepEqual(formatChatSelection(formatted.text, formatted.start, formatted.end, '**'), {text:'Привет соседи!', start:7, end:13})
})
test('renders nested bold and italic as a text-only tree', () => {
  assert.deepEqual(parseChatFormatting('**Доброе _утро_**'), [{style:'strong',children:[{text:'Доброе '},{style:'em',children:[{text:'утро'}]}]}])
})
test('HTML and unmatched delimiters remain literal text', () => {
  assert.deepEqual(parseChatFormatting('<script>alert(1)</script> **test'), [{text:'<script>alert(1)</script> **test'}])
})
test('code keeps its formatting delimiters literal', () => {
  assert.deepEqual(parseChatFormatting('`**code**`'), [{style:'code',children:[{text:'**code**'}]}])
})
test('empty selection does not insert stray markers', () => {
  assert.deepEqual(formatChatSelection('текст',2,2,'_'), {text:'текст',start:2,end:2})
})
