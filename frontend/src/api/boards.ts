import { z } from 'zod'
import { fetchJson } from '@/api/client'
import { taskSchema } from '@/api/tasks'

export const boardRoleSchema = z.enum(['owner', 'editor', 'viewer'])
export type BoardRole = z.infer<typeof boardRoleSchema>
const shareRoleSchema = z.enum(['editor', 'viewer'])
export type ShareRole = z.infer<typeof shareRoleSchema>

const summarySchema = z.object({
  id: z.string(),
  name: z.string(),
  updated_at: z.string(),
  my_role: boardRoleSchema,
  owner: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** Anyone with the board's public link can view it. */
  public: z.boolean(),
})

export type BoardSummary = z.infer<typeof summarySchema>

/** Whether the role lets the person change the board's content and name. */
export const canEdit = (role: BoardRole) => role !== 'viewer'

const xy = z.object({ x: z.number(), y: z.number() })

// The doc mirrors xyflow's node and edge shapes; the backend validates the details.
const docNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['task_card', 'frame', 'sticky', 'text', 'module', 'anchor', 'timer']),
  position: xy,
  width: z.number().optional(),
  height: z.number().optional(),
  parentId: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
})

const docEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
})

export const docSchema = z.object({
  nodes: z.array(docNodeSchema),
  edges: z.array(docEdgeSchema),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
})

export type BoardDoc = z.infer<typeof docSchema>
export type DocNode = z.infer<typeof docNodeSchema>

const boardSchema = summarySchema.extend({
  version: z.number(),
  doc: docSchema,
  // By ref, `source:key`.
  tasks: z.record(z.string(), taskSchema),
  // The tracker of a card that names none.
  default_source: z.string(),
})

export type Board = z.infer<typeof boardSchema>

const listSchema = z.object({ boards: z.array(summarySchema), all: z.array(summarySchema) })
export type BoardList = z.infer<typeof listSchema>

/** The person's boards, and for admins every other board in `all`. */
export function listBoards() {
  return fetchJson('/api/boards', listSchema)
}

const memberSchema = z.object({
  user: z.object({ id: z.string(), username: z.string(), name: z.string() }),
  role: boardRoleSchema,
})
export type Member = z.infer<typeof memberSchema>

export function listMembers(boardId: string) {
  return fetchJson(
    `/api/boards/${boardId}/members`,
    z.object({
      members: z.array(memberSchema),
      everyone_role: shareRoleSchema.nullable(),
      public: z.boolean(),
      // Only the owner gets the link itself.
      public_token: z.string().nullable(),
    }),
  )
}

/** Turns the board's public link on or off; a link turned off never works again. */
export function setPublicLink(boardId: string, isPublic: boolean) {
  return fetchJson(
    `/api/boards/${boardId}/public`,
    z.object({ public: z.boolean(), public_token: z.string().nullable() }),
    { method: 'PUT', body: JSON.stringify({ public: isPublic }) },
  )
}

export const publicUrl = (token: string) => `${window.location.origin}/p/${token}`

export function shareBoard(boardId: string, userId: string, role: ShareRole) {
  return fetchJson(`/api/boards/${boardId}/members/${userId}`, memberSchema, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  })
}

export function unshareBoard(boardId: string, userId: string) {
  return fetchJson(`/api/boards/${boardId}/members/${userId}`, z.null(), { method: 'DELETE' })
}

export function shareWithEveryone(boardId: string, role: ShareRole | null) {
  return fetchJson(`/api/boards/${boardId}/everyone`, z.null(), {
    method: 'PUT',
    body: JSON.stringify({ role }),
  })
}

export function transferBoard(boardId: string, userId: string) {
  return fetchJson(`/api/boards/${boardId}/transfer`, z.null(), {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  })
}

const directorySchema = z.object({
  people: z.array(z.object({ id: z.string(), username: z.string(), name: z.string() })),
})

export function findPeople(query: string) {
  return fetchJson(`/api/people/directory?q=${encodeURIComponent(query)}`, directorySchema)
}

export function createBoard(name: string) {
  return fetchJson('/api/boards', summarySchema, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function renameBoard(id: string, name: string) {
  return fetchJson(`/api/boards/${id}`, summarySchema, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function deleteBoard(id: string) {
  return fetchJson(`/api/boards/${id}`, z.null(), { method: 'DELETE' })
}

export function getBoard(id: string) {
  return fetchJson(`/api/boards/${id}`, boardSchema)
}

const sourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.enum(['ok', 'error']),
  synced_at: z.string().nullable(),
  error: z
    .object({ code: z.string(), message: z.string(), retry_after: z.number().nullable() })
    .nullable(),
  // What to know about this tracker's sync while it works, such as a slower pace.
  note: z.string().nullish(),
})

export type SyncSource = z.infer<typeof sourceSchema>

export const refreshSchema = z.object({
  tasks: z.record(z.string(), taskSchema),
  fetched_at: z.string(),
  sources: z.array(sourceSchema),
})

export function refreshBoard(id: string) {
  return fetchJson(`/api/boards/${id}/refresh`, refreshSchema, { method: 'POST' })
}
