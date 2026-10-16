import { useQueryClient } from '@tanstack/react-query'
import { Check, Plus } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { addField, storeField, type Field } from '@/api/planning'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  ADD_COLUMN_WIDTH,
  cellValue,
  COLUMN_WIDTH,
  MAX_COLUMNS,
  MAX_VALUE,
  setValue,
  toggleColumn,
} from '@/modules/gantt/fields'
import { HEADER, type Row } from '@/modules/gantt/rows'
import type { GanttContent } from '@/modules/gantt/schema'
import { cn } from '@/lib/utils'
import { toastError } from '@/lib/toast'

type Props = {
  content: GanttContent
  visible: Row[]
  fields: Field[]
  rowHeight: number
  /** Height of the Time off lane, kept empty here so cells stay level with their rows. */
  lane: number
  onChange: (content: GanttContent) => void
  onRow: (row: Row) => void
}

/** Field columns between the titles and the timeline; an empty cell shows its parent's value. */
export function GanttColumns({
  content,
  visible,
  fields,
  rowHeight,
  lane,
  onChange,
  onRow,
}: Props) {
  const columns = content.columns ?? []
  const nameOf = (id: string) => fields.find((f) => f.id === id)?.name ?? 'Unknown'
  return (
    <div data-gantt-columns className="flex shrink-0 flex-col border-r">
      <div className="flex shrink-0 border-b" style={{ height: HEADER }}>
        {columns.map((id) => (
          <div
            key={id}
            title={nameOf(id)}
            className="text-muted-foreground flex items-center justify-center border-r px-1.5 text-center font-medium"
            style={{ width: COLUMN_WIDTH }}
          >
            <span className="truncate">{nameOf(id)}</span>
          </div>
        ))}
        <ColumnPicker content={content} fields={fields} onChange={onChange} />
      </div>
      {lane > 0 && <div className="bg-muted shrink-0 border-b" style={{ height: lane }} />}
      {visible.map((row) => (
        <div
          key={row.id}
          className="flex shrink-0 border-b border-border/60"
          style={{ height: rowHeight }}
        >
          {columns.map((id) => {
            const { value, own } = cellValue(content.rows, row, id)
            return (
              <Cell
                key={id}
                label={`${nameOf(id)} of ${row.title || row.key || 'row'}`}
                value={own ? value : ''}
                inherited={own ? '' : value}
                onSave={(text) => onRow(setValue(row, id, text))}
              />
            )
          })}
          <div style={{ width: ADD_COLUMN_WIDTH }} />
        </div>
      ))}
    </div>
  )
}

/** Typed straight in; saved on blur or Enter, Escape keeps the old value. */
function Cell({
  label,
  value,
  inherited,
  onSave,
}: {
  label: string
  value: string
  inherited: string
  onSave: (text: string) => void
}) {
  // Null while not typing, so a value changed by someone else shows at once.
  const [draft, setDraft] = useState<string | null>(null)
  const cancel = useRef(false)
  const save = () => {
    const next = (draft ?? value).trim()
    setDraft(null)
    if (!cancel.current && next !== value) onSave(next)
    cancel.current = false
  }
  return (
    <input
      aria-label={label}
      value={draft ?? value}
      placeholder={inherited}
      title={draft === null ? value || inherited : undefined}
      maxLength={MAX_VALUE}
      onFocus={() => setDraft(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Escape') cancel.current = true
        if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur()
      }}
      className="placeholder:text-muted-foreground hover:bg-accent focus:bg-card focus:ring-primary h-full min-w-0 truncate border-r bg-transparent px-1.5 text-center outline-none focus:ring-1 focus:ring-inset"
      style={{ width: COLUMN_WIDTH }}
    />
  )
}

function ColumnPicker({
  content,
  fields,
  onChange,
}: {
  content: GanttContent
  fields: Field[]
  onChange: (content: GanttContent) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const columns = content.columns ?? []
  const full = columns.length >= MAX_COLUMNS
  const create = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || saving || full) return
    setSaving(true)
    try {
      const created = await addField(trimmed)
      storeField(queryClient, created)
      setName('')
      onChange(toggleColumn(content, created.id))
    } catch (error) {
      toastError(error as Error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Columns"
          title="Show a field as a column"
          className="text-muted-foreground hover:text-foreground hover:bg-accent flex shrink-0 items-center justify-center"
          style={{ width: ADD_COLUMN_WIDTH }}
        >
          <Plus className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-60 p-3">
        <div className="flex flex-col gap-2 text-[13px]">
          <div className="font-semibold">Columns</div>
          <div role="group" aria-label="Fields" className="flex flex-col">
            {fields
              .filter((f) => !f.archived)
              .map((f) => {
                const shown = columns.includes(f.id)
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={shown}
                    disabled={!shown && full}
                    onClick={() => onChange(toggleColumn(content, f.id))}
                    className="hover:bg-accent flex items-center gap-2 rounded-[4px] px-2 py-1 text-left disabled:opacity-50"
                  >
                    <Check className={cn('size-3.5', !shown && 'invisible')} />
                    {f.name}
                  </button>
                )
              })}
          </div>
          <form onSubmit={create} className="flex gap-1.5">
            <Input
              aria-label="New field"
              placeholder="New field, e.g. Quarter"
              maxLength={40}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-8"
            />
            <Button type="submit" size="sm" disabled={!name.trim() || saving || full}>
              Add
            </Button>
          </form>
          <p className="text-muted-foreground text-[12px]">
            Up to {MAX_COLUMNS} columns. Fields are shared by every board; an empty cell shows the
            parent row's value.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
