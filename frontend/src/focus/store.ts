import { useSyncExternalStore } from 'react'
import { chime, notify } from './alerts'
import {
  applySettings,
  DEFAULT_SETTINGS,
  initialState,
  normalizeSettings,
  tick,
  type TimerSettings,
  type TimerState,
} from './timer'
import { didOnboarding } from '@/onboarding/done'

export interface FocusStore {
  settings: TimerSettings
  timer: TimerState
  visible: boolean
  now: number
}

const KEY = 'tiko.focus'
// A phase that ended this long before the page noticed (closed tab) ends quietly.
const LATE_ALERT = 5_000

function load(): FocusStore {
  const now = Date.now()
  const settings = { ...DEFAULT_SETTINGS }
  const fresh: FocusStore = { settings, timer: initialState(settings), visible: true, now }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return fresh
    const loaded = normalizeSettings(raw.settings ?? {})
    const t = raw.timer
    const valid =
      t &&
      ['focus', 'short', 'long'].includes(t.phase) &&
      ['idle', 'running', 'paused', 'finished'].includes(t.status) &&
      typeof t.left === 'number' &&
      typeof t.round === 'number' &&
      (t.status !== 'running' || typeof t.endsAt === 'number')
    const timer: TimerState = valid ? t : initialState(loaded)
    return { settings: loaded, timer, visible: raw.visible !== false, now }
  } catch {
    return fresh
  }
}

let store: FocusStore | null = null
const listeners = new Set<() => void>()
let ticker: ReturnType<typeof setInterval> | null = null

function current(): FocusStore {
  store ??= load()
  return store
}

function save(next: FocusStore) {
  try {
    const { settings, timer, visible } = next
    localStorage.setItem(KEY, JSON.stringify({ settings, timer, visible }))
  } catch {
    // Storage blocked: the timer still runs for this page.
  }
}

function set(next: FocusStore, persist = true) {
  store = next
  if (persist) save(next)
  listeners.forEach((listener) => listener())
  syncTicker()
}

function onTick() {
  const s = current()
  const now = Date.now()
  const { state, ended } = tick(s.timer, s.settings, now)
  if (ended && s.timer.endsAt !== null && now - s.timer.endsAt < LATE_ALERT) {
    if (s.settings.sound) chime()
    if (s.settings.notify) notify(ended)
  }
  set({ ...s, timer: state, now }, state !== s.timer)
}

// Ticks only while a phase runs; the end time, not the tick count, drives the clock.
function syncTicker() {
  const running = store?.timer.status === 'running' && listeners.size > 0
  if (running && !ticker) ticker = setInterval(onTick, 250)
  if (!running && ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) onTick()
  syncTicker()
  return () => {
    listeners.delete(listener)
    syncTicker()
  }
}

export function updateTimer(
  change: (timer: TimerState, settings: TimerSettings, now: number) => TimerState,
) {
  const s = current()
  const now = Date.now()
  const timer = change(s.timer, s.settings, now)
  if (timer.status === 'running' && s.timer.status !== 'running') didOnboarding('focus')
  set({ ...s, timer, now })
}

export function updateSettings(patch: Partial<TimerSettings>) {
  const s = current()
  const settings = normalizeSettings({ ...s.settings, ...patch })
  set({ ...s, settings, timer: applySettings(s.timer, settings), now: Date.now() })
}

export function setFocusVisible(visible: boolean) {
  set({ ...current(), visible })
}

const serverStore: FocusStore = {
  settings: DEFAULT_SETTINGS,
  timer: initialState(DEFAULT_SETTINGS),
  visible: false,
  now: 0,
}

export function useFocus(): FocusStore {
  return useSyncExternalStore(subscribe, current, () => serverStore)
}

export function useFocusVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => current().visible,
    () => false,
  )
}

/** Tests start from a clean store. */
export function resetFocusStore() {
  store = null
  if (ticker) clearInterval(ticker)
  ticker = null
}
