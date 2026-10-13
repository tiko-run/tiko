// Copy buttons and the one-time rise of blocks as they scroll into view.

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy ?? '')
      button.classList.add('copied')
      setTimeout(() => button.classList.remove('copied'), 1600)
    } catch {
      // No clipboard access: select the command, so one key press copies it.
      const code = button.parentElement?.querySelector('code')
      if (code) getSelection()?.selectAllChildren(code)
    }
  })
}

const rise = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('in')
      rise.unobserve(entry.target)
    }
  },
  { rootMargin: '0px 0px -8% 0px' },
)
for (const el of document.querySelectorAll('.reveal')) rise.observe(el)
document.documentElement.classList.add('rising')
