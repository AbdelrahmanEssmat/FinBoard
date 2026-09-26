import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemePref = 'system' | 'light' | 'dark'

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

export function applyTheme(theme: ThemePref) {
  const root = document.documentElement
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]:not([media])') as HTMLMetaElement | null
  if (meta) meta.content = dark ? '#0b0f17' : '#f6f7f9'
}
