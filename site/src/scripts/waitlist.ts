// The Cloud waitlist forms. Turnstile loads only when someone opens or uses a form.

type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string
  execute: (id: string) => void
  reset: (id: string) => void
}
declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
let loading: Promise<Turnstile> | undefined

function turnstile(): Promise<Turnstile> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('no turnstile')))
    script.onerror = () => {
      loading = undefined
      reject(new Error('turnstile did not load'))
    }
    document.head.append(script)
  })
  return loading
}

function setup(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>('.form')!
  const input = form.querySelector<HTMLInputElement>('input[type="email"]')!
  const news = form.querySelector<HTMLInputElement>('input[name="news"]')!
  const button = form.querySelector<HTMLButtonElement>('button')!
  const fields = form.querySelector<HTMLElement>('.fields')!
  const opt = form.querySelector<HTMLElement>('.opt')!
  const open = root.querySelector<HTMLAnchorElement>('[data-open]')
  let widget: string | undefined
  let pending: ((token: string | null) => void) | undefined

  const show = (state: string) => {
    for (const el of form.querySelectorAll<HTMLElement>('[data-state]')) el.hidden = el.dataset.state !== state
  }

  const token = async (): Promise<string | null> => {
    const ts = await turnstile()
    widget ??= ts.render(form.querySelector<HTMLElement>('.check')!, {
      sitekey: root.dataset.sitekey,
      execution: 'execute',
      appearance: 'interaction-only',
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'auto',
      callback: (t: string) => pending?.(t),
      'error-callback': () => {
        pending?.(null)
        return true
      },
    })
    return new Promise((resolve) => {
      pending = resolve
      ts.execute(widget!)
    })
  }

  open?.addEventListener('click', (event) => {
    event.preventDefault()
    open.hidden = true
    form.hidden = false
    input.focus()
    turnstile().catch(() => {})
  })
  input.addEventListener('focus', () => turnstile().catch(() => {}), { once: true })
  input.addEventListener('input', () => {
    input.removeAttribute('aria-invalid')
    show('idle')
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const email = input.value.trim()
    if (!EMAIL.test(email)) {
      input.setAttribute('aria-invalid', 'true')
      show('bad')
      return
    }
    button.disabled = true
    try {
      const t = await token()
      if (!t) throw new Error('check failed')
      const response = await fetch(root.dataset.url!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: root.dataset.waitlist, token: t, news: news.checked }),
      })
      if (response.status === 400) {
        input.setAttribute('aria-invalid', 'true')
        show('bad')
      } else if (!response.ok) {
        show('error')
      } else {
        fields.hidden = true
        opt.hidden = true
        show(news.checked ? 'news' : 'done')
      }
    } catch {
      show('error')
    } finally {
      button.disabled = false
      // A token is good for one request; the next try needs a fresh one.
      if (widget) window.turnstile?.reset(widget)
    }
  })
}

for (const root of document.querySelectorAll<HTMLElement>('[data-waitlist]')) setup(root)
