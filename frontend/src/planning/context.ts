import { createContext, useContext } from 'react'
import type { Field, Person, StageType } from '@/api/planning'

export type PlanningState = {
  enabled: boolean
  types: StageType[]
  people: Person[]
  fields: Field[]
}

// Off until the instance says otherwise: a guest or a demo visitor never asks.
export const PlanningContext = createContext<PlanningState>({
  enabled: false,
  types: [],
  people: [],
  fields: [],
})

export const usePlanning = () => useContext(PlanningContext)
