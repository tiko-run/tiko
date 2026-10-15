import { sharedFlag } from '@/lib/shared-flag'

// Shared by the list and About, which live in different trees.
const checklist = sharedFlag()

export const setChecklistOpen = checklist.set
export const useChecklistOpen = checklist.use
