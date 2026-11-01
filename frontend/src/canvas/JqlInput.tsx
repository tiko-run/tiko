import { useQuery } from '@tanstack/react-query'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from 'react'
import { getJqlValues, getJqlVocabulary, searchTasks, type JqlVocabulary } from '@/api/tasks'
import { Textarea } from '@/components/ui/textarea'
import { applySuggestion, jqlContext, rank, type JqlContext } from '@/lib/jql'
import { cn } from '@/lib/utils'
import { Scroller } from '@/components/Scroller'

const VALUE_DELAY_MS = 150
const COUNT_DELAY_MS = 400
// A first token like "DEV-15" is an issue key being typed, not the start of a query.
const KEY_START = /^[A-Za-z][A-Za-z0-9_]*-/

type Suggestion = { insert: string; label: string }

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** Match count of a query, checked by Jira while the user pauses typing. */
export function useJqlCount(jql: string, enabled: boolean) {
  const query = jql.trim()
  const debounced = useDebounced(query, COUNT_DELAY_MS)
  return useQuery({
    queryKey: ['jql-count', debounced],
    queryFn: () => searchTasks(debounced, 0),
    enabled: enabled && debounced !== '' && debounced === query,
    retry: false,
    staleTime: 30_000,
  })
}

/** Radix closes the popover on Escape before the input sees it; this keeps it open while the list is shown. */
export function keepOpenWhileSuggesting(event: Event) {
  if ((document.activeElement as HTMLElement | null)?.dataset.suggesting === 'true') {
    event.preventDefault()
  }
}

function suggestionsFor(
  context: JqlContext,
  vocabulary: JqlVocabulary | undefined,
  values: Suggestion[],
): Suggestion[] {
  if (!vocabulary || context.kind === 'none') return []
  if (context.first && (!context.token || KEY_START.test(context.token))) return []
  const field = vocabulary.fields.find(
    (f) => f.name.toLowerCase() === context.field?.replace(/^"|"$/g, '').toLowerCase(),
  )
  switch (context.kind) {
    case 'field':
      return rank(vocabulary.fields, context.token, (f) => `${f.name} ${f.label}`).map((f) => ({
        insert: f.name,
        label: f.label,
      }))
    case 'operator':
      return rank(field?.operators ?? [], context.token, (op) => op).map((op) => ({
        insert: op,
        label: op,
      }))
    case 'keyword':
      return rank(context.keywords ?? [], context.token, (word) => word).map((word) => ({
        insert: word,
        label: word,
      }))
    case 'value': {
      const empty = context.operator?.startsWith('is') || context.operator?.startsWith('was')
      const extra = [
        ...(empty ? ['EMPTY'] : []),
        ...(context.token ? vocabulary.functions : []),
        ...(context.operator === 'is' ? ['not'] : []),
      ]
      const words = rank(extra, context.token, (word) => word).map((word) => ({
        insert: word,
        label: word,
      }))
      return [...values, ...words].slice(0, 8)
    }
  }
}

type Props = Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
  /** Earlier inputs offered while the field is empty. */
  recent?: string[]
  onPickRecent?: (input: string) => void
}

/** Growing JQL field with suggestions: Tab inserts, arrows move, Enter inserts after arrows or submits, Shift+Enter breaks the line. */
export function JqlInput({
  value,
  onValueChange,
  recent = [],
  onPickRecent,
  className,
  ...props
}: Props) {
  const input = useRef<HTMLTextAreaElement>(null)
  const [cursor, setCursor] = useState(value.length)
  const [highlight, setHighlight] = useState(0)
  const [navigated, setNavigated] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const pendingCursor = useRef<number | null>(null)

  const vocabulary = useQuery({
    queryKey: ['jql-vocabulary'],
    queryFn: getJqlVocabulary,
    staleTime: 10 * 60_000,
    retry: false,
  })
  const context = useMemo(() => jqlContext(value, cursor), [value, cursor])
  // Field and typed value as one string, so the debounce compares by value.
  const wanted =
    context.kind === 'value' && context.field ? `${context.field}\n${context.token}` : ''
  const asked = useDebounced(wanted, VALUE_DELAY_MS)
  const [askedField, askedToken = ''] = asked.split('\n')
  const values = useQuery({
    queryKey: ['jql-values', asked],
    queryFn: () => getJqlValues(askedField, askedToken.replace(/^"/, '')),
    enabled: asked !== '',
    staleTime: 60_000,
    retry: false,
  })
  const current =
    asked !== '' && asked === wanted
      ? (values.data ?? []).map((v) => ({ insert: v.value, label: v.label }))
      : []
  const picking = value === '' && recent.length > 0
  const items = dismissed
    ? []
    : picking
      ? recent.map((input) => ({ insert: input, label: input }))
      : suggestionsFor(context, vocabulary.data, current)
  const open = items.length > 0
  const active = Math.min(highlight, items.length - 1)

  useLayoutEffect(() => {
    if (pendingCursor.current === null || !input.current) return
    input.current.setSelectionRange(pendingCursor.current, pendingCursor.current)
    setCursor(pendingCursor.current)
    pendingCursor.current = null
  }, [value])

  // Grows with the text so a long or pasted multi-line query stays readable.
  useLayoutEffect(() => {
    const field = input.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`
  }, [value])

  const track = () => setCursor(input.current?.selectionStart ?? value.length)

  const apply = (item: Suggestion) => {
    if (picking) {
      setHighlight(0)
      setNavigated(false)
      onPickRecent?.(item.insert)
      return
    }
    const next = applySuggestion(value, context, item.insert)
    pendingCursor.current = next.cursor
    setHighlight(0)
    setNavigated(false)
    onValueChange(next.text)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const submit = event.key === 'Enter' && !event.shiftKey && !(open && navigated)
    if (submit) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setHighlight((active + step + items.length) % items.length)
      setNavigated(true)
    } else if (event.key === 'Tab' || (event.key === 'Enter' && navigated)) {
      event.preventDefault()
      apply(items[active])
    } else if (event.key === 'Escape') {
      setDismissed(true)
    }
  }

  return (
    // The list floats above the field, so the popover keeps its size while suggestions change.
    <div className="relative">
      <Textarea
        {...props}
        ref={input}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls="jql-suggestions"
        aria-autocomplete="list"
        aria-activedescendant={open ? `jql-suggestion-${active}` : undefined}
        data-suggesting={open}
        rows={1}
        className={cn('max-h-48 min-h-8 resize-none py-1.5', className)}
        onChange={(event) => {
          setDismissed(false)
          setHighlight(0)
          setNavigated(false)
          setCursor(event.target.selectionStart ?? event.target.value.length)
          onValueChange(event.target.value)
        }}
        onKeyDown={onKeyDown}
        onKeyUp={track}
        onClick={track}
        onBlur={() => setDismissed(true)}
        onFocus={() => setDismissed(false)}
      />
      {open && (
        <Scroller
          className="bg-popover text-popover-foreground absolute right-0 bottom-full left-0 z-10 mb-1 rounded-md border shadow-md"
          viewportClassName="max-h-64 p-1"
        >
          <ul
            id="jql-suggestions"
            role="listbox"
            aria-label={picking ? 'Recent inputs' : 'Suggestions'}
          >
            {items.map((item, i) => (
              <li
                key={`${item.insert}-${i}`}
                id={`jql-suggestion-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn(
                  'flex cursor-default items-baseline justify-between gap-2 rounded-sm px-2 py-1 text-[13px]',
                  i === active && 'bg-accent',
                )}
                // Keep focus in the input so typing can go on after a click.
                onMouseDown={(event) => {
                  event.preventDefault()
                  apply(item)
                }}
                onMouseMove={() => setHighlight(i)}
              >
                <span className="truncate">{item.label}</span>
                {!picking && item.insert.replace(/^"|"$/g, '') !== item.label && (
                  <span className="text-muted-foreground shrink-0 font-mono text-xs">
                    {item.insert}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Scroller>
      )}
    </div>
  )
}
