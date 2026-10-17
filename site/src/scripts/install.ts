// Windows visitors get the PowerShell command; everyone else keeps the shell script.

type NavigatorUA = Navigator & { userAgentData?: { platform?: string } }

const platform = ((navigator as NavigatorUA).userAgentData?.platform || navigator.platform || navigator.userAgent).toLowerCase()
if (/^win|windows/.test(platform)) {
  for (const root of document.querySelectorAll<HTMLElement>('[data-install]')) {
    for (const panel of root.querySelectorAll<HTMLElement>('[data-for]')) panel.hidden = panel.dataset.for !== 'ps1'
  }
}
