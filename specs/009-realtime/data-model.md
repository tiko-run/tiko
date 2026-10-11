# Data Model: Real-time boards

## Storage

One migration, `008_live.sql`:

```sql
ALTER TABLE boards ADD COLUMN ydoc BLOB;   -- encoded Y.Doc state; NULL until the board is first opened live
```

`boards.doc` (JSON) and `boards.version` stay and are written in the same statement as `ydoc`, so REST readers never see one without the other. Nothing else is stored: no update log, no presence.

## Shared document

One `Y.Doc` per board with two root maps. Every leaf is a plain value replaced as a whole (last writer wins per key).

```text
nodes: Y.Map<id, Y.Map>
  type    "task_card" | "frame" | "sticky" | "text" | "module" | "anchor" | "timer"   set once
  place   {x, y, parentId?}      one value, so a move into a frame never mixes with another move
  size    {width?, height?}      one value
  order   number                 stacking; a new or raised node takes max + 1
  data    Y.Map<field, value>    the fields of the node's data model in domain/boards.py;
                                 a module's content is one value

edges: Y.Map<id, {source, target, sourceHandle?, targetHandle?}>   one value per edge
```

The viewport is not in the document. Task data is not in the document: a card carries only its `key`.

## Projection to `BoardDoc`

The same pure function on the server (Python) and in the browser (TypeScript), covered by shared fixtures:

1. Nodes sorted by `order`, then id.
2. Each child moved to right after its parent, keeping that order among siblings, so parents come first as xyflow and `check_doc` need.
3. Edges sorted by id.

The browser additionally leaves out, without writing anything, a node whose parent is missing or of the wrong type and an edge with a missing end. They reappear repaired when the server's fix arrives.

## Repair (server only)

Run after every applied update, in one transaction with the server's origin; the result must pass `BoardDoc` validation and `check_doc`.

| Violation | Fix |
|---|---|
| A node's parent is missing or is not a frame (not a timer) | `place` becomes top-level at the absolute position, computed from the parent's last known place |
| A frame or module with a parent | same: made top-level |
| A timer whose holder is missing, an anchor or a timer | the timer is deleted |
| An edge with a missing end | the edge is deleted; an anchor left with no edge is deleted |
| A node that fails `BoardDoc` validation | restored to its last valid state; a node that never had one is deleted |
| More than `MAX_NODES` nodes | the nodes added by that update are deleted |

Every repair is logged with the board id and the rule, never with content.

## From JSON to the document

`apply_json(ydoc, doc)` makes the document equal to a `BoardDoc` by diff: nodes and edges missing from the JSON are deleted, new ones added, changed keys set; `order` follows the array index. It is used when a room opens a board with no `ydoc` (boards from before this release, the welcome board, boards created through REST) and for `PUT /boards/{id}`.

## Room

In memory, one per open board: the `Y.Doc`, the connections with their person, session and current role, the last valid projection, and a save timer. Created on the first join, saved and dropped 30 s after the last leave.

## Browser

`localStorage["tiko:viewport:<boardId>"] = {x, y, zoom}`, written debounced on pan and zoom. Missing or unreadable means the board opens fitted to its content.
