import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import '@/styles/index.css'
import { App } from '@/app/App'
import { applyTheme, usePrefs } from '@/store/prefs'

applyTheme(usePrefs.getState().theme)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(usePrefs.getState().theme))
usePrefs.subscribe((s, prev) => {
  if (s.theme !== prev.theme) applyTheme(s.theme)
})

registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
