import { beforeEach, expect, test } from 'vitest'
import * as Y from 'yjs'
import type { AppEdge, AppNode } from '@/canvas/types'
import { LOCAL, LiveBinding } from '@/live/binding'

/** A tab without React: canvas state, a binding and the pull a remote change schedules. */
class Tab {
  doc = new Y.Doc()
  nodes: AppNode[] = []
  edges: AppEdge[] = []
  remoteChanges = 0
  live = new LiveBinding(this.doc, () => this.remoteChanges++)
  history = new Y.UndoManager([this.live.nodes, this.live.edges], {
    trackedOrigins: new Set([LOCAL]),
    captureTimeout: 0,
  })

  /** A change on the canvas, committed. */
  set(nodes: AppNode[], edges: AppEdge[] = this.edges) {
    this.nodes = nodes
    this.edges = edges
    this.live.push(this.nodes, this.edges)
  }

  /** The frame after remote changes arrived. */
  pull() {
    this.set(this.live.pullNodes(this.nodes), this.live.pullEdges(this.edges))
  }

  ids() {
    return this.nodes.map((node) => node.id)
  }
}

const sticky = (id: string, extra: Partial<AppNode> = {}): AppNode =>
  ({
    id,
    type: 'sticky',
    position: { x: 0, y: 0 },
    data: { text: id, color: 'yellow' },
    ...extra,
  }) as AppNode

const frame = (id: string): AppNode =>
  ({ id, type: 'frame', position: { x: 100, y: 100 }, data: { title: '' } }) as AppNode

function sync(...tabs: Tab[]) {
  for (const from of tabs) {
    for (const to of tabs) {
      if (from !== to) Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc), 'remote')
    }
  }
  for (const tab of tabs) tab.pull()
}

let ann: Tab
let bob: Tab

beforeEach(() => {
  // The board was made by someone else, so nothing on it is in Ann's or Bob's undo history.
  const owner = new Tab()
  owner.set([sticky('a'), sticky('b')])
  ann = new Tab()
  bob = new Tab()
  sync(owner, ann, bob)
})

test('an added node reaches the other tab', () => {
  expect(bob.ids()).toEqual(['a', 'b'])
  bob.set([...bob.nodes, sticky('c')])
  sync(ann, bob)
  expect(ann.ids()).toEqual(['a', 'b', 'c'])
})

test('changes to different fields of one node both stay', () => {
  ann.set(ann.nodes.map((n) => (n.id === 'a' ? { ...n, position: { x: 50, y: 60 } } : n)))
  bob.set(
    bob.nodes.map((n) =>
      n.id === 'a' ? ({ ...n, data: { ...n.data, text: 'hi' } } as AppNode) : n,
    ),
  )
  sync(ann, bob)
  for (const tab of [ann, bob]) {
    expect(tab.nodes[0]).toMatchObject({ position: { x: 50, y: 60 }, data: { text: 'hi' } })
  }
})

test('the same field changed by both ends with one value everywhere', () => {
  ann.set(ann.nodes.map((n) => (n.id === 'a' ? { ...n, position: { x: 1, y: 1 } } : n)))
  bob.set(bob.nodes.map((n) => (n.id === 'a' ? { ...n, position: { x: 2, y: 2 } } : n)))
  sync(ann, bob)
  expect(ann.nodes[0].position).toEqual(bob.nodes[0].position)
})

test('a remote change keeps the node selected and leaves untouched nodes as they were', () => {
  const [a, b] = bob.nodes
  bob.set([{ ...a, selected: true }, b])
  ann.set(ann.nodes.map((n) => (n.id === 'a' ? { ...n, position: { x: 9, y: 9 } } : n)))
  sync(ann, bob)
  expect(bob.nodes[0]).toMatchObject({ selected: true, position: { x: 9, y: 9 } })
  expect(bob.nodes[1]).toBe(b)
})

test('a pull with nothing new returns the same arrays', () => {
  expect(ann.live.pullNodes(ann.nodes)).toBe(ann.nodes)
  expect(ann.live.pullEdges(ann.edges)).toBe(ann.edges)
})

test('a deletion reaches the other tab and is not undone by its next change', () => {
  ann.set(ann.nodes.filter((n) => n.id !== 'a'))
  Y.applyUpdate(bob.doc, Y.encodeStateAsUpdate(ann.doc), 'remote')
  // Bob commits something unrelated before his canvas has taken the deletion in.
  bob.set(bob.nodes.map((n) => (n.id === 'b' ? { ...n, selected: true } : n)))
  sync(ann, bob)
  expect(ann.ids()).toEqual(['b'])
  expect(bob.ids()).toEqual(['b'])
})

test('a change that has not been pulled yet is not written back', () => {
  ann.set(ann.nodes.map((n) => (n.id === 'a' ? { ...n, position: { x: 7, y: 7 } } : n)))
  Y.applyUpdate(bob.doc, Y.encodeStateAsUpdate(ann.doc), 'remote')
  // Bob edits another field of the same node while Ann's move is still on its way in.
  bob.set(
    bob.nodes.map((n) =>
      n.id === 'a' ? ({ ...n, data: { ...n.data, text: 'x' } } as AppNode) : n,
    ),
  )
  sync(ann, bob)
  expect(ann.nodes[0]).toMatchObject({ position: { x: 7, y: 7 }, data: { text: 'x' } })
  expect(bob.nodes[0]).toMatchObject({ position: { x: 7, y: 7 }, data: { text: 'x' } })
})

test('a drag is written once, on the drop, and a dragged node is not moved by others', () => {
  const updates: Uint8Array[] = []
  bob.doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === LOCAL) updates.push(update)
  })
  for (const x of [10, 20, 30]) {
    bob.set(
      bob.nodes.map((n) => (n.id === 'a' ? { ...n, dragging: true, position: { x, y: 0 } } : n)),
    )
  }
  expect(updates).toHaveLength(0)
  ann.set(ann.nodes.map((n) => (n.id === 'a' ? { ...n, position: { x: -5, y: -5 } } : n)))
  Y.applyUpdate(bob.doc, Y.encodeStateAsUpdate(ann.doc), 'remote')
  bob.pull()
  expect(bob.nodes[0].position).toEqual({ x: 30, y: 0 })
  bob.set(bob.nodes.map((n) => (n.id === 'a' ? { ...n, dragging: false } : n)))
  expect(updates).toHaveLength(1)
  sync(ann, bob)
  expect(ann.nodes[0].position).toEqual({ x: 30, y: 0 })
})

test('a node whose frame is gone is hidden, not deleted, and comes back repaired', () => {
  ann.set([frame('f'), sticky('a'), sticky('b')])
  sync(ann, bob)
  ann.set(ann.nodes.filter((n) => n.id !== 'f'))
  bob.set(bob.nodes.map((n) => (n.id === 'a' ? { ...n, parentId: 'f' } : n)))
  sync(ann, bob)
  expect(ann.ids()).toEqual(['b'])
  expect(bob.ids()).toEqual(['b'])
  expect(ann.live.nodes.has('a')).toBe(true)
  // The server's repair: the node becomes top-level at its absolute position.
  const server = new Y.Doc()
  Y.applyUpdate(server, Y.encodeStateAsUpdate(ann.doc))
  server.getMap<Y.Map<unknown>>('nodes').get('a')!.set('place', { x: 100, y: 100 })
  for (const tab of [ann, bob]) Y.applyUpdate(tab.doc, Y.encodeStateAsUpdate(server), 'remote')
  sync(ann, bob)
  expect(ann.ids().sort()).toEqual(['a', 'b'])
  expect(bob.nodes.find((n) => n.id === 'a')).toMatchObject({ position: { x: 100, y: 100 } })
  expect(bob.nodes.find((n) => n.id === 'a')?.parentId).toBeUndefined()
})

test('arrows follow their nodes', () => {
  ann.set(ann.nodes, [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'right' }])
  sync(ann, bob)
  expect(bob.edges).toEqual([{ id: 'e', source: 'a', target: 'b', sourceHandle: 'right' }])
  bob.set(bob.nodes, [])
  sync(ann, bob)
  expect(ann.edges).toEqual([])
})

test('stacking: a node raised to the top is on top for everyone', () => {
  const [a, b] = ann.nodes
  ann.set([b, a])
  sync(ann, bob)
  expect(bob.ids()).toEqual(['b', 'a'])
  bob.set([...bob.nodes, sticky('c')])
  sync(ann, bob)
  expect(ann.ids()).toEqual(['b', 'a', 'c'])
})

test('children stay after their frame for everyone', () => {
  ann.set([sticky('a'), frame('f'), sticky('in', { parentId: 'f' }), sticky('b')])
  sync(ann, bob)
  expect(bob.ids()).toEqual(['a', 'f', 'in', 'b'])
})

test('a viewer pulls and never writes', () => {
  const carl = new Tab()
  carl.live.canWrite = false
  sync(ann, carl)
  expect(carl.ids()).toEqual(['a', 'b'])
  const before = Y.encodeStateVector(carl.doc)
  carl.set([sticky('forged')])
  expect(Y.encodeStateVector(carl.doc)).toEqual(before)
  ann.set(ann.nodes.filter((n) => n.id !== 'a'))
  carl.nodes = [sticky('a'), sticky('b')]
  carl.live.reset()
  sync(ann, carl)
  expect(carl.ids()).toEqual(['b'])
})

test('undo reverts only this tab own steps', () => {
  ann.set([...ann.nodes, sticky('mine')])
  bob.set(bob.nodes.map((n) => (n.id === 'a' ? { ...n, position: { x: 44, y: 44 } } : n)))
  sync(ann, bob)
  ann.history.undo()
  sync(ann, bob)
  expect(ann.ids()).toEqual(['a', 'b'])
  expect(ann.nodes[0].position).toEqual({ x: 44, y: 44 })
  expect(bob.ids()).toEqual(['a', 'b'])
  ann.history.redo()
  sync(ann, bob)
  expect(bob.ids()).toEqual(['a', 'b', 'mine'])
})

test('undo of a change someone else has since deleted does nothing', () => {
  ann.set(ann.nodes.map((n) => (n.id === 'a' ? { ...n, position: { x: 5, y: 5 } } : n)))
  sync(ann, bob)
  bob.set(bob.nodes.filter((n) => n.id !== 'a'))
  sync(ann, bob)
  ann.history.undo()
  sync(ann, bob)
  expect(ann.ids()).toEqual(['b'])
  expect(bob.ids()).toEqual(['b'])
})

test('the first sync replaces what the tab showed from the saved board', () => {
  const late = new Tab()
  late.nodes = [sticky('stale')]
  Y.applyUpdate(late.doc, Y.encodeStateAsUpdate(ann.doc), 'remote')
  late.nodes = late.live.reset().nodes
  late.live.push(late.nodes, late.edges)
  expect(late.ids()).toEqual(['a', 'b'])
  sync(ann, late)
  expect(ann.ids()).toEqual(['a', 'b'])
})

test('edits made offline on both sides merge with nothing doubled and nothing lost', () => {
  // Neither tab hears the other until the end, as after a dropped connection.
  ann.set([
    ...ann.nodes.map((n) => (n.id === 'a' ? { ...n, position: { x: 70, y: 70 } } : n)),
    sticky('ann-offline'),
  ])
  ann.set(ann.nodes, [{ id: 'e1', source: 'a', target: 'ann-offline' }])
  bob.set([...bob.nodes, sticky('bob-meanwhile')])
  bob.set(bob.nodes.filter((n) => n.id !== 'b'))
  sync(ann, bob)
  for (const tab of [ann, bob]) {
    expect(tab.ids().sort()).toEqual(['a', 'ann-offline', 'bob-meanwhile'])
    expect(tab.nodes.find((n) => n.id === 'a')?.position).toEqual({ x: 70, y: 70 })
    expect(tab.edges.map((edge) => edge.id)).toEqual(['e1'])
  }
})

test('a patch outside the undo history stays when the edit before it is undone', () => {
  const picture = {
    id: 'p',
    type: 'image',
    position: { x: 0, y: 0 },
    data: { w: 10, h: 10, color: '#000000' },
  } as AppNode
  ann.set([...ann.nodes, picture])
  ann.history.stopCapturing()
  ann.set(ann.nodes.map((n) => (n.id === 'a' ? { ...n, position: { x: 50, y: 0 } } : n)))
  ann.history.stopCapturing()
  expect(ann.live.patchData('p', { file: 'f'.repeat(32) })).toBe(true)
  ann.pull()
  ann.history.undo()
  ann.pull()
  expect(ann.nodes.find((n) => n.id === 'a')?.position.x).toBe(0)
  const data = ann.nodes.find((n) => n.id === 'p')?.data as { file?: string } | undefined
  expect(data?.file).toBe('f'.repeat(32))
  expect(ann.live.patchData('gone', { file: 'x' })).toBe(false)
})
