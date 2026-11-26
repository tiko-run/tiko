import { describe, expect, it } from 'vitest'
import type { GanttContent } from '@/modules/gantt/schema'
import { formatDay, parseDay } from '@/modules/gantt/timeline'
import {
  addChild,
  branchSpan,
  childrenSpan,
  foldAll,
  resizeParent,
  indent,
  insertRow,
  liftRemove,
  removeBranch,
  moveRows,
  moveSubtree,
  movingDepth,
  outdent,
  shiftBranch,
  visibleRows,
} from '@/modules/gantt/tree'

type Row = GanttContent['rows'][number]

const row = (id: string, parent?: string, start = '2026-10-05', end = '2026-10-09'): Row => ({
  id,
  title: id,
  start,
  end,
  ...(parent && { parent }),
})

const content = (rows: Row[]): GanttContent => ({
  start: '2026-10-01',
  end: '2026-12-31',
  scale: 'week',
  labelWidth: 160,
  rows,
  milestones: [],
  links: [],
})

// A
//   B
//     C
//   D
// E
const tree = content([row('A'), row('B', 'A'), row('C', 'B'), row('D', 'A'), row('E')])
const shape = (c: GanttContent) => c.rows.map((r) => `${r.id}<${r.parent ?? '-'}`).join(' ')

describe('tree', () => {
  it('lists rows with depth, hiding collapsed subtrees', () => {
    expect(
      visibleRows(tree.rows).map((t) => `${t.row.id}${t.depth}${t.hasChildren ? '+' : ''}`),
    ).toEqual(['A0+', 'B1+', 'C2', 'D1', 'E0'])
    const folded = tree.rows.map((r) => (r.id === 'B' ? { ...r, collapsed: true } : r))
    expect(visibleRows(folded).map((t) => t.row.id)).toEqual(['A', 'B', 'D', 'E'])
  })

  it('covers the own dates of a parent and everything under it', () => {
    const rows = [
      row('A', undefined, '2026-10-01', '2026-10-02'),
      row('B', 'A', '2026-10-10', '2026-10-12'),
      row('C', 'B', '2026-11-01', '2026-11-20'),
      row('D', 'A', '2026-10-05', '2026-10-06'),
    ]
    const days = (span: { start: number; end: number }) => [
      formatDay(span.start),
      formatDay(span.end),
    ]
    expect(days(branchSpan(rows, 0))).toEqual(['2026-10-01', '2026-11-20'])
    expect(days(branchSpan(rows, 1))).toEqual(['2026-10-10', '2026-11-20'])
    expect(days(childrenSpan(rows, 0)!)).toEqual(['2026-10-05', '2026-11-20'])
    expect(childrenSpan(rows, 3)).toBeNull()
  })

  it('stretches a parent past its only child but never cuts it off', () => {
    // An epic over one story: same dates until the epic is stretched.
    const chainOfOne = content([
      row('E', undefined, '2026-10-12', '2026-10-16'),
      row('S', 'E', '2026-10-12', '2026-10-16'),
    ])
    const wider = resizeParent(chainOfOne, 'E', {
      start: parseDay('2026-10-01'),
      end: parseDay('2026-10-16'),
    })
    expect([wider.rows[0].start, wider.rows[0].end]).toEqual(['2026-10-01', '2026-10-16'])
    const cut = resizeParent(wider, 'E', {
      start: parseDay('2026-10-14'),
      end: parseDay('2026-10-16'),
    })
    expect([cut.rows[0].start, cut.rows[0].end]).toEqual(['2026-10-12', '2026-10-16'])
  })

  it('moves a subtree under another row', () => {
    expect(shape(moveSubtree(tree, 'B', 'E', 1))).toBe('A<- D<A B<A C<B E<-')
    expect(shape(moveSubtree(tree, 'E', 'D', 2))).toBe('A<- B<A C<B E<B D<A')
  })

  it('keeps the tree valid when the depth asked for does not fit', () => {
    // Before D (depth 1), a root would orphan D, so the row lands at depth 1.
    expect(shape(moveSubtree(tree, 'E', 'D', 0))).toBe('A<- B<A C<B E<A D<A')
    // Nothing deeper than one level below the row above.
    expect(shape(moveSubtree(tree, 'E', null, 4))).toBe('A<- B<A C<B D<A E<D')
    // Not into its own subtree.
    expect(moveSubtree(tree, 'A', 'C', 3)).toBe(tree)
  })

  it('indents under the row above and outdents after the parent', () => {
    expect(shape(indent(tree, 'E'))).toBe('A<- B<A C<B D<A E<A')
    expect(shape(indent(tree, 'D'))).toBe('A<- B<A C<B D<B E<-')
    expect(shape(outdent(tree, 'C'))).toBe('A<- B<A C<A D<A E<-')
    expect(shape(outdent(tree, 'B'))).toBe('A<- D<A B<- C<B E<-')
  })

  it('adds a child at the end of a subtree and opens the parent', () => {
    const folded = content(tree.rows.map((r) => (r.id === 'A' ? { ...r, collapsed: true } : r)))
    const next = addChild(folded, 'A', row('X'))
    expect(shape(next)).toBe('A<- B<A C<B D<A X<A E<-')
    expect(next.rows[0].collapsed).toBe(false)
  })

  it('shifts a branch by whole days, leaving the rest', () => {
    const next = shiftBranch(tree, 'B', 3)
    expect(next.rows.map((r) => r.start)).toEqual([
      '2026-10-05',
      '2026-10-08',
      '2026-10-08',
      '2026-10-05',
      '2026-10-05',
    ])
  })

  it('lifts children of a removed row one level up', () => {
    expect(shape(liftRemove(tree, 'B'))).toBe('A<- C<A D<A E<-')
    expect(shape(liftRemove(tree, 'A'))).toBe('B<- C<B D<- E<-')
  })

  it('removes a row with its whole branch and the links that touch it', () => {
    expect(shape(removeBranch(tree, 'B'))).toBe('A<- D<A E<-')
    expect(shape(removeBranch(tree, 'A'))).toBe('E<-')
    const linked = { ...tree, links: [{ id: 'l', from: 'C', to: 'E' }] }
    expect(removeBranch(linked, 'B').links).toEqual([])
  })

  it('inserts a new row next to the row above', () => {
    expect(shape(insertRow(tree, row('X'), 'D', 0)!)).toBe('A<- B<A C<B X<A D<A E<-')
    expect(shape(insertRow(tree, row('X'), 'E', 0)!)).toBe('A<- B<A C<B D<A X<- E<-')
  })

  it('refuses to go deeper than five levels', () => {
    const deep = content([
      row('0'),
      row('1', '0'),
      row('2', '1'),
      row('3', '2'),
      row('4', '3'),
      row('X'),
    ])
    expect(moveSubtree(deep, 'X', null, 5)).toBe(deep)
    expect(shape(addChild(deep, '4', row('Y')))).toBe(shape(deep))
  })
})

describe('foldAll', () => {
  const plan = content([row('a'), row('b', 'a'), row('c', 'b'), row('d')])

  it('folds and unfolds every row with children, leaves alone the rest', () => {
    const folded = foldAll(plan, true)
    expect(folded.rows.map((r) => Boolean(r.collapsed))).toEqual([true, true, false, false])
    expect(visibleRows(folded.rows).map((t) => t.row.id)).toEqual(['a', 'd'])
    const open = foldAll(folded, false)
    expect(visibleRows(open.rows).map((t) => t.row.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns the same content when nothing changes', () => {
    expect(foldAll(plan, false)).toBe(plan)
  })
})

describe('moveRows', () => {
  it('puts a branch after a row as its sibling or its child', () => {
    expect(shape(moveRows(tree, ['E'], 'A', 0))).toBe('A<- B<A C<B D<A E<-')
    expect(shape(moveRows(tree, ['E'], 'A', 1))).toBe('A<- B<A C<B D<A E<A')
    expect(shape(moveRows(tree, ['E'], null, 0))).toBe('E<- A<- B<A C<B D<A')
    expect(shape(moveRows(tree, ['E'], 'C', 2))).toBe('A<- B<A C<B E<B D<A')
    expect(shape(moveRows(tree, ['B'], 'D', 1))).toBe('A<- D<A B<A C<B E<-')
  })

  it('lands after the whole branch of the row above at that depth', () => {
    expect(shape(moveRows(tree, ['E'], 'C', 0))).toBe('A<- B<A C<B D<A E<-')
    expect(shape(moveRows(tree, ['E'], 'C', 1))).toBe('A<- B<A C<B E<A D<A')
  })

  it('opens a collapsed parent so a row dropped in it stays in view', () => {
    const folded = {
      ...tree,
      rows: tree.rows.map((r) => (r.id === 'B' ? { ...r, collapsed: true } : r)),
    }
    const moved = moveRows(folded, ['E'], 'B', 2)
    expect(shape(moved)).toBe('A<- B<A C<B E<B D<A')
    expect(moved.rows.find((r) => r.id === 'B')!.collapsed).toBe(false)
    expect(visibleRows(moved.rows).map((t) => t.row.id)).toContain('E')
  })

  it('never puts a row under a row hidden in a collapsed branch', () => {
    // A folded: C is hidden, so after A the deepest level is a child of A.
    const folded = {
      ...tree,
      rows: tree.rows.map((r) => (r.id === 'A' ? { ...r, collapsed: true } : r)),
    }
    expect(shape(moveRows(folded, ['E'], 'A', 3))).toBe('A<- B<A C<B D<A E<A')
  })

  it('moves several branches in plan order as siblings at one depth', () => {
    expect(shape(moveRows(tree, ['E', 'C'], 'D', 1))).toBe('A<- B<A D<A C<A E<A')
    // C rides with A, its picked ancestor.
    expect(shape(moveRows(tree, ['C', 'A'], 'E', 0))).toBe('E<- A<- B<A C<B D<A')
  })

  it('keeps the tree within five levels and leaves it alone otherwise', () => {
    const deep = content([
      row('1'),
      row('2', '1'),
      row('3', '2'),
      row('4', '3'),
      row('X'),
      row('Y', 'X'),
    ])
    expect(movingDepth(deep.rows, ['X'])).toBe(1)
    expect(moveRows(deep, ['X'], '4', 4)).toBe(deep)
    expect(shape(moveRows(deep, ['X'], '4', 3))).toBe('1<- 2<1 3<2 4<3 X<3 Y<X')
    expect(moveRows(deep, ['X'], 'X', 0)).toBe(deep)
  })

  it('returns the same content for a drop where the rows already are', () => {
    expect(moveRows(tree, ['D'], 'C', 1)).toBe(tree)
    expect(moveRows(tree, [], 'C', 1)).toBe(tree)
  })
})
