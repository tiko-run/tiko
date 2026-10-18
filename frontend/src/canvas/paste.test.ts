import { afterEach, describe, expect, it } from 'vitest'
import {
  CLIPBOARD_MARKER,
  classifyPaste,
  isEditable,
  readPasteAs,
  writePasteAs,
} from '@/canvas/paste'
import { pastedRefs } from '@/canvas/refs'

const clip = (data: Record<string, string>) => ({ getData: (type: string) => data[type] ?? '' })

describe('pastedRefs', () => {
  it('takes keys and task links split by lines, spaces and commas', () => {
    const text =
      'https://jira.example.com/browse/DEMO-1\nDEMO-2, https://jira.example.com/browse/DEMO-3/'
    expect(pastedRefs(text)?.refs).toEqual([
      'https://jira.example.com/browse/DEMO-1',
      'DEMO-2',
      'https://jira.example.com/browse/DEMO-3/',
    ])
  })

  it('takes GitHub issue and pull request links and keys', () => {
    const refs = [
      'https://github.com/octo-org/widgets/issues/12',
      'https://github.com/octo-org/widgets/pull/7/files',
      'https://github.com/octo-org/widgets/issues/12#issuecomment-1',
      'octo-org/widgets#3',
    ]
    expect(pastedRefs(refs.join('\n'))?.refs).toEqual(refs)
    expect(pastedRefs('https://github.com/octo-org/widgets')).toBeNull()
    expect(pastedRefs('https://github.com/octo-org/widgets/discussions/5')).toBeNull()
  })

  it('leaves text with other words or other links alone', () => {
    expect(pastedRefs('Fix DEMO-1 today')).toBeNull()
    expect(pastedRefs('https://example.com/docs/setup')).toBeNull()
  })

  it('keeps at most 50 refs', () => {
    const keys = Array.from({ length: 60 }, (_, i) => `DEMO-${i + 1}`).join(' ')
    expect(pastedRefs(keys)?.refs).toHaveLength(50)
    expect(pastedRefs(keys)?.more).toBe(true)
  })
})

describe('classifyPaste', () => {
  it('pastes elements when the clipboard carries this copy', () => {
    expect(classifyPaste(clip({ [CLIPBOARD_MARKER]: 'c1' }), 'c1')).toEqual({ kind: 'elements' })
  })

  it('prefers outside text over an older copy', () => {
    expect(classifyPaste(clip({ 'text/plain': 'Ask Sam' }), 'c1')).toEqual({
      kind: 'text',
      text: 'Ask Sam',
    })
  })

  it('turns task refs into cards', () => {
    expect(classifyPaste(clip({ 'text/plain': 'DEMO-1 DEMO-2' }), null)).toEqual({
      kind: 'refs',
      refs: ['DEMO-1', 'DEMO-2'],
      more: false,
    })
  })

  it('keeps line breaks and cuts very long text', () => {
    const pasted = classifyPaste(clip({ 'text/plain': `a\nb${'x'.repeat(6000)}` }), null)
    expect(pasted).toMatchObject({ kind: 'text' })
    expect(pasted?.kind === 'text' && pasted.text.slice(0, 3)).toBe('a\nb')
    expect(pasted?.kind === 'text' && pasted.text.length).toBe(5000)
  })

  it('ignores an empty paste', () => {
    expect(classifyPaste(clip({ 'text/plain': '  \n' }), null)).toBeNull()
  })
})

describe('isEditable', () => {
  it('lets fields and dialogs take the paste', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inner = document.createElement('div')
    dialog.append(inner)
    expect(isEditable(document.createElement('textarea'))).toBe(true)
    expect(isEditable(document.createElement('input'))).toBe(true)
    expect(isEditable(inner)).toBe(true)
    expect(isEditable(document.body)).toBe(false)
  })
})

describe('paste preference', () => {
  afterEach(() => localStorage.clear())

  it('defaults to text and remembers a sticky note', () => {
    expect(readPasteAs()).toBe('text')
    writePasteAs('sticky')
    expect(readPasteAs()).toBe('sticky')
  })
})
