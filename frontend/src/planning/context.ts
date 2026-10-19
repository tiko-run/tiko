import { createContext, useContext } from 'react'
import type { Field, Person, SavedView, StageType } from '@/api/planning'

export type PlanningState = {
  enabled: boolean
  types: StageType[]
  people: Person[]
  fields: Field[]
  views: SavedView[]
  daysOff: string[]
  // The demo's made-up lists: picked from, never added to.
  sample: boolean
}

// Off until the instance says otherwise: a guest or a demo visitor never asks.
export const PlanningContext = createContext<PlanningState>({
  enabled: false,
  types: [],
  people: [],
  fields: [],
  views: [],
  daysOff: [],
  sample: false,
})

export const usePlanning = () => useContext(PlanningContext)
