import { createContext, useContext } from 'react'
import type { StageType } from '@/api/planning'

export type PlanningState = {
  enabled: boolean
  types: StageType[]
}

// Off until the instance says otherwise: a guest or a demo visitor never asks.
export const PlanningContext = createContext<PlanningState>({
  enabled: false,
  types: [],
})

export const usePlanning = () => useContext(PlanningContext)
