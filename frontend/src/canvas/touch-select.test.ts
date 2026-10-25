import type { InternalNode } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { boxBetween, frameFlips, keepPicked, keepPickedEdges, picks } from '@/canvas/touch-select'
import type { AppEdge, AppNode } from '@/canvas/types'

function node(
  id: string,
  type: string,
  x: number,
  y: number,
  w: number,
  h: number,
  selected = false,
) {
  const user = { id, type, position: { x, y }, data: {}, selected } as unknown as AppNode
  return {
    ...user,
    measured: { width: w, height: h },
    internals: { positionAbsolute: { x, y }, z: 0, userNode: user },
  } as unknown as InternalNode<AppNode>
}

const lookup = (...nodes: InternalNode<AppNode>[]) => new Map(nodes.map((n) => [n.id, n]))

// A frame at 0..400 with a note half across the box drawn inside it.
const frame = node('f', 'frame', 0, 0, 400, 400)
const note = node('n', 'sticky', 100, 100, 100, 100)
const inside = boxBetween({ x: 150, y: 150 }, { x: 300, y: 300 })

describe('picks', () => {
  it('takes an element the box only touches', () => {
    expect(picks(note, inside)).toBe(true)
  })

  it('leaves an element the box misses', () => {
    expect(picks(node('far', 'sticky', 900, 900, 50, 50), inside)).toBe(false)
  })

  it('takes a frame only when covered whole', () => {
    expect(picks(frame, inside)).toBe(false)
    expect(picks(frame, boxBetween({ x: -10, y: -10 }, { x: 410, y: 410 }))).toBe(true)
  })

  it('builds the same box whichever way it is drawn', () => {
    expect(boxBetween({ x: 300, y: 300 }, { x: 150, y: 150 })).toEqual(inside)
  })
})

describe('keepPicked', () => {
  it('drops the frame xyflow selects for a touch, and resets its early mark', () => {
    frame.selected = true
    const kept = keepPicked(
      [
        { type: 'select', id: 'f', selected: true },
        { type: 'select', id: 'n', selected: true },
      ],
      lookup(frame, note),
      inside,
    )
    expect(kept.map((c) => (c.type === 'select' ? c.id : ''))).toEqual(['n'])
    expect(frame.selected).toBe(false)
  })

  it('drops a node xyflow takes without touching it', () => {
    const unmeasured = node('u', 'sticky', 900, 900, 50, 50)
    expect(
      keepPicked([{ type: 'select', id: 'u', selected: true }], lookup(unmeasured), inside),
    ).toEqual([])
  })

  it('passes deselection and other changes through', () => {
    const changes = [
      { type: 'select', id: 'f', selected: false },
      { type: 'remove', id: 'f' },
    ] as const
    expect(keepPicked([...changes], lookup(frame), inside)).toHaveLength(2)
  })
})

describe('keepPickedEdges', () => {
  it('keeps an arrow only with a picked end', () => {
    const far = node('far', 'sticky', 900, 900, 50, 50)
    const edges = [
      { id: 'a', source: 'n', target: 'far' },
      { id: 'b', source: 'f', target: 'far' },
    ] as AppEdge[]
    const kept = keepPickedEdges(
      [
        { type: 'select', id: 'a', selected: true },
        { type: 'select', id: 'b', selected: true },
      ],
      edges,
      lookup(frame, note, far),
      inside,
    )
    expect(kept.map((c) => (c.type === 'select' ? c.id : ''))).toEqual(['a'])
  })
})

describe('frameFlips', () => {
  it('selects a frame once the box grows over it', () => {
    const f = node('f', 'frame', 0, 0, 100, 100)
    expect(
      frameFlips(lookup(f), boxBetween({ x: -5, y: -5 }, { x: 105, y: 105 }), new Set()),
    ).toEqual([{ id: 'f', selected: true }])
  })

  it('drops a frame this box took once it shrinks off it', () => {
    const f = node('f', 'frame', 0, 0, 100, 100, true)
    const box = boxBetween({ x: -5, y: -5 }, { x: 50, y: 50 })
    expect(frameFlips(lookup(f), box, new Set(['f']))).toEqual([{ id: 'f', selected: false }])
  })

  it('keeps a frame selected before the box', () => {
    const f = node('f', 'frame', 0, 0, 100, 100, true)
    expect(
      frameFlips(lookup(f), boxBetween({ x: -5, y: -5 }, { x: 50, y: 50 }), new Set()),
    ).toEqual([])
  })
})
