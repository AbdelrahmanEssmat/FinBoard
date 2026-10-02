import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@/styles/index.css'
import { App } from '@/app/App'
import { applyTheme, usePrefs } from '@/store/prefs'
import { installErrorReporting } from '@/app/errorReporting'

// installed on a home screen (no browser chrome): the layout sizes itself to the whole screen
const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches
if (standalone) document.documentElement.dataset.standalone = 'true'

applyTheme(usePrefs.getState().theme)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(usePrefs.getState().theme))
usePrefs.subscribe((s, prev) => {
  if (s.theme !== prev.theme) applyTheme(s.theme)
})

installErrorReporting()
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
