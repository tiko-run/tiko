// Plays the hero board: rewinds the finished scene of the markup and acts it out in a loop.
// A drag by the visitor stops the loop until "Replay".

const board = document.querySelector<HTMLElement>('[data-board]')
const still = matchMedia('(prefers-reduced-motion: reduce)')

const STATUS: Record<string, string> = {
  todo: 'To do',
  progress: 'In progress',
  review: 'In review',
  done: 'Done',
}
const KEYS = 'APP-112 APP-118 APP-121 APP-127'
const STOPPED = Symbol('stopped')

if (board) {
  const one = <T extends HTMLElement>(selector: string) => board.querySelector<T>(selector)!
  const all = (selector: string) => [...board.querySelectorAll<HTMLElement>(selector)]

  const cards = all('[data-card]')
  const bars = all('[data-bar]')
  const rows = all('[data-gantt-row]')
  const popover = one('[data-popover]')
  const typed = one('[data-typed]')
  const sync = one('[data-sync]')
  const syncText = one('[data-sync-text]')
  const sticky = one('[data-sticky]')
  const cursor = one('[data-cursor]')
  const timer = one('[data-timer]')
  const timerLeft = one('[data-timer-left]')
  const note = one('[data-note]')
  const cardTool = one('[data-tool="card"]')
  const selectTool = one('[data-tool="mouse-pointer-2"]')
  const hint = document.querySelector<HTMLElement>('[data-hint]')
  const replay = document.querySelector<HTMLButtonElement>('[data-replay]')

  // Each play has a number; a sleep that wakes up in an older play throws and ends it.
  let play = 0
  const sleep = (ms: number) => {
    const mine = play
    return new Promise<void>((resolve, reject) =>
      setTimeout(() => (mine === play ? resolve() : reject(STOPPED)), ms),
    )
  }

  let seen = false
  new IntersectionObserver(([entry]) => (seen = entry.isIntersecting), { threshold: 0.2 }).observe(
    board,
  )
  const shown = async () => {
    while (!seen || document.hidden) await sleep(400)
  }

  const setStatus = (id: string, status: string) => {
    const card = cards.find((c) => c.dataset.card === id)!
    card.dataset.status = status
    card.querySelector('[data-lozenge]')!.textContent = STATUS[status]
    const bar = bars.find((b) => b.dataset.bar === id)
    if (bar) bar.dataset.status = status
  }
  const flash = (el: HTMLElement, name: string) => {
    el.classList.remove(name)
    void el.offsetWidth
    el.classList.add(name)
  }
  const synced = () => {
    syncText.textContent = 'Synced just now'
    flash(sync, 'pulse')
  }
  const place = (el: HTMLElement, x?: number, y?: number) => {
    if (x === undefined) el.style.removeProperty('--x')
    else el.style.setProperty('--x', String(x))
    if (y === undefined) el.style.removeProperty('--y')
    else el.style.setProperty('--y', String(y))
  }

  const rewind = () => {
    for (const el of all('[data-drag]')) place(el)
    for (const el of [...cards, ...bars, ...rows, note]) el.classList.add('out')
    popover.classList.add('out')
    cursor.classList.add('out')
    sticky.classList.remove('gliding')
    place(cursor)
    typed.textContent = ''
    setStatus('c1', 'todo')
    setStatus('c2', 'review')
    timer.dataset.state = 'running'
    timerLeft.textContent = '3s'
    syncText.textContent = 'Synced 28s ago'
    cardTool.classList.remove('active')
    selectTool.classList.add('active')
  }

  // The scene as the markup has it: what a visitor without motion sees.
  const finish = () => {
    for (const el of all('[data-drag]')) place(el)
    for (const el of [...cards, ...bars, ...rows, note]) el.classList.remove('out')
    popover.classList.add('out')
    cursor.classList.add('out')
    sticky.classList.remove('gliding')
    place(cursor)
    setStatus('c1', 'progress')
    setStatus('c2', 'done')
    timer.dataset.state = 'fired'
    syncText.textContent = 'Synced just now'
    cardTool.classList.remove('active')
    selectTool.classList.add('active')
  }

  const scene = async () => {
    await sleep(700)

    // Keys typed into the card tool become cards.
    selectTool.classList.remove('active')
    cardTool.classList.add('active')
    popover.classList.remove('out')
    await sleep(450)
    for (const char of KEYS) {
      typed.textContent += char
      await sleep(42)
    }
    await sleep(350)
    popover.classList.add('out')
    cardTool.classList.remove('active')
    selectTool.classList.add('active')
    for (const card of cards) {
      card.classList.remove('out')
      await sleep(130)
    }
    await sleep(1100)

    // The tracker changed a status: the card follows on its own.
    synced()
    setStatus('c1', 'progress')
    flash(cards[0], 'flash')
    await sleep(1400)

    // Someone else on the board moves the note.
    cursor.classList.remove('out')
    await sleep(50)
    place(cursor, 600, 150)
    await sleep(1000)
    sticky.classList.add('gliding')
    place(sticky, 548, 116)
    place(cursor, 628, 166)
    await sleep(1000)
    place(cursor, 760, 330)
    await sleep(500)
    cursor.classList.add('out')
    sticky.classList.remove('gliding')

    // Cards planned on the Gantt.
    for (const row of rows) row.classList.remove('out')
    await sleep(250)
    for (const bar of bars) {
      bar.classList.remove('out')
      await sleep(220)
    }
    await sleep(1300)

    synced()
    setStatus('c2', 'done')
    flash(cards[1], 'flash')
    await sleep(1300)

    // The timer runs out.
    for (const left of ['2s', '1s']) {
      timerLeft.textContent = left
      await sleep(800)
    }
    timer.dataset.state = 'fired'
    await sleep(350)
    note.classList.remove('out')
    await sleep(4200)
  }

  const start = async () => {
    const mine = ++play
    hint?.removeAttribute('hidden')
    replay?.setAttribute('hidden', '')
    try {
      while (mine === play) {
        await shown()
        rewind()
        await scene()
      }
    } catch (reason) {
      if (reason !== STOPPED) throw reason
    }
  }
  const stop = () => {
    play++
    hint?.setAttribute('hidden', '')
    replay?.removeAttribute('hidden')
  }

  // Dragging moves an element in board units, whatever the board's size on screen.
  board.addEventListener('pointerdown', (down) => {
    const el = (down.target as HTMLElement).closest<HTMLElement>('[data-drag]')
    if (!el || el.classList.contains('out')) return
    stop()
    const unit = board.clientWidth / (board.clientWidth <= 640 ? 400 : 1120)
    const x = el.offsetLeft / unit
    const y = el.offsetTop / unit
    try {
      el.setPointerCapture(down.pointerId)
    } catch {}
    el.classList.add('dragging')
    const move = (event: PointerEvent) =>
      place(el, x + (event.clientX - down.clientX) / unit, y + (event.clientY - down.clientY) / unit)
    const up = () => {
      el.classList.remove('dragging')
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  })

  replay?.addEventListener('click', () => {
    if (!still.matches) return void start()
    finish()
    replay.setAttribute('hidden', '')
  })
  // Motion turned off while the scene plays: stop it on the finished board.
  still.addEventListener('change', () => {
    if (!still.matches) return void start()
    play++
    finish()
  })
  if (!still.matches) start()
}
