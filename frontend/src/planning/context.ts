import { createContext, useContext } from 'react'
import type { Person, StageType } from '@/api/planning'

export type PlanningState = {
  enabled: boolean
  types: StageType[]
  people: Person[]
}

// Off until the instance says otherwise: a guest or a demo visitor never asks.
export const PlanningContext = createContext<PlanningState>({
  enabled: false,
  types: [],
  people: [],
})

export const usePlanning = () => useContext(PlanningContext)
