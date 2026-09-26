import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Search } from 'lucide-react'
import { usePrefs } from '@/store/prefs'
import { CurrencyToggle } from '@/layout/CurrencyToggle'

/** Phone-only top bar: display currency, search and privacy. */
export function TopBar() {
  const { privacy, togglePrivacy } = usePrefs()
  const navigate = useNavigate()
  return (
    <header className="pt-safe sticky top-0 z-30 bg-bg/85 backdrop-blur md:hidden">
      <div className="flex h-14 items-center justify-between px-5">
        <CurrencyToggle />
        <div className="flex items-center gap-1">
          <button onClick={() => navigate('/search')} aria-label="Search" className="flex h-10 w-10 items-center justify-center rounded-full text-muted active:bg-surface-2">
            <Search className="h-5 w-5" />
          </button>
          <button onClick={togglePrivacy} aria-label="Toggle privacy" className="flex h-10 w-10 items-center justify-center rounded-full text-muted active:bg-surface-2">
            {privacy ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </header>
  )
}
