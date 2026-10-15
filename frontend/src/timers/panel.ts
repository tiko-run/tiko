import { sharedFlag } from '@/lib/shared-flag'
import { didOnboarding } from '@/onboarding/done'

// Shared by the board's timer button and the main menu, which live in different trees.
const panel = sharedFlag((open) => open && didOnboarding('timer_list'))

export const setTimerPanelOpen = panel.set
export const useTimerPanelOpen = panel.use
