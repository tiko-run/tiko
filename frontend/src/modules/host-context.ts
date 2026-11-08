import { createContext } from 'react'
import type { ModuleHost } from '@/modules/types'

export const ModuleHostContext = createContext<ModuleHost>({
  addTasks: () => {},
  ejectCard: () => {},
  ejectNote: () => {},
  syncContent: () => {},
})
