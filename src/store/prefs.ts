import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemePref = 'system' | 'light' | 'dim' | 'dark'

export const THEME_COLORS: Record<'light' | 'dim' | 'dark', string> = { light: '#f4f5f8', dim: '#2b3140', dark: '#161b24' }

interface Prefs {
  privacy: boolean
  theme: ThemePref
  /** Display currency override; null = settings.base_currency */
  displayCurrency: string | null
  lastSubAccountId: string | null
  lastCurrency: string | null
  lastExpenseCategoryId: string | null
  lastIncomeCategoryId: string | null
  setPrivacy: (v: boolean) => void
  togglePrivacy: () => void
  setTheme: (t: ThemePref) => void
  setDisplayCurrency: (c: string | null) => void
  remember: (p: Partial<Pick<Prefs, 'lastSubAccountId' | 'lastCurrency' | 'lastExpenseCategoryId' | 'lastIncomeCategoryId'>>) => void
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      privacy: false,
      theme: 'system',
      displayCurrency: null,
      lastSubAccountId: null,
      lastCurrency: null,
      lastExpenseCategoryId: null,
      lastIncomeCategoryId: null,
      setPrivacy: (privacy) => set({ privacy }),
      togglePrivacy: () => set((s) => ({ privacy: !s.privacy })),
      setTheme: (theme) => set({ theme }),
      setDisplayCurrency: (displayCurrency) => set({ displayCurrency }),
      remember: (p) => set(p),
    }),
    { name: 'finance-prefs' },
  ),
)

/** Resolve the preference to the concrete theme ("system" follows the OS between light and dark). */
export function resolveTheme(theme: ThemePref): 'light' | 'dim' | 'dark' {
  if (theme === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return theme
}

export function applyTheme(theme: ThemePref) {
  const root = document.documentElement
  const resolved = resolveTheme(theme)
  root.classList.toggle('dark', resolved === 'dark')
  root.classList.toggle('dim', resolved === 'dim')
  root.style.colorScheme = resolved === 'light' ? 'light' : 'dark'
  let meta = document.querySelector('meta[name="theme-color"]:not([media])') as HTMLMetaElement | null
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = THEME_COLORS[resolved]
}
