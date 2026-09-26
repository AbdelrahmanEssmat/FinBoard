import { NavLink, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Plus, Search } from 'lucide-react'
import { usePrefs } from '@/store/prefs'
import { cn } from '@/utils'
import { CurrencyToggle } from '@/layout/CurrencyToggle'
import { SIDEBAR_EXTRA, TABS } from '@/layout/nav'

export function Sidebar({ onQuickAdd }: { onQuickAdd: () => void }) {
  const { privacy, togglePrivacy } = usePrefs()
  const navigate = useNavigate()
  const items = [...TABS.filter((t) => t.to !== '/more'), ...SIDEBAR_EXTRA]
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface md:sticky md:top-0 md:flex md:h-dvh">
      <div className="px-6 pb-5 pt-7">
        <div className="text-lg font-semibold tracking-tight">Finance</div>
        <div className="text-xs text-muted">Net worth &amp; spending</div>
      </div>
      <div className="px-4">
        <button onClick={onQuickAdd} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent text-[15px] font-medium text-white shadow-sm hover:brightness-110">
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      <nav className="mt-5 flex-1 space-y-1 overflow-y-auto px-4">
        {items.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/'}
            className={({ isActive }) =>
              cn('flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] transition-colors', isActive ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-text')
            }
          >
            <t.icon className="h-[18px] w-[18px]" />
            {t.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border p-4">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate('/search')} aria-label="Search" className="flex h-10 w-10 items-center justify-center rounded-xl text-muted hover:bg-surface-2">
            <Search className="h-[18px] w-[18px]" />
          </button>
          <button onClick={togglePrivacy} aria-label="Toggle privacy" className="flex h-10 w-10 items-center justify-center rounded-xl text-muted hover:bg-surface-2">
            {privacy ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
          <div className="ml-auto">
            <CurrencyToggle />
          </div>
        </div>
      </div>
    </aside>
  )
}
