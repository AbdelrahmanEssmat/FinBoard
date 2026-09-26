import { useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Landmark, ArrowLeftRight, HandCoins, Ellipsis, Plus, Eye, EyeOff, Search, Percent, TrendingUp,
  Gem, PieChart, BarChart3, Settings, Repeat, Tags, WifiOff, CloudUpload,
} from 'lucide-react'
import { usePrefs } from '@/lib/prefs'
import { useConnectivity, useDailyJobs, useRealtimeSync } from '@/lib/sync'
import { cn } from '@/lib/utils'
import { QuickAddSheet } from '@/features/quickadd/QuickAddSheet'
import { CurrencyToggle } from './CurrencyToggle'

const tabs = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/accounts', label: 'Accounts', icon: Landmark },
  { to: '/transactions', label: 'Activity', icon: ArrowLeftRight },
  { to: '/debts', label: 'Debts', icon: HandCoins },
  { to: '/more', label: 'More', icon: Ellipsis },
]

const sidebarExtra = [
  { to: '/certificates', label: 'Certificates', icon: Percent },
  { to: '/investments', label: 'Investments', icon: TrendingUp },
  { to: '/gold', label: 'Gold', icon: Gem },
  { to: '/budgets', label: 'Budgets', icon: PieChart },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/recurring', label: 'Recurring', icon: Repeat },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function AppShell({ children }: { children: ReactNode }) {
  const [quickAdd, setQuickAdd] = useState(false)
  const { privacy, togglePrivacy } = usePrefs()
  const { online, pending } = useConnectivity()
  const navigate = useNavigate()
  const location = useLocation()
  useRealtimeSync()
  useDailyJobs()

  const isMore = location.pathname === '/more'

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface md:flex md:sticky md:top-0 md:h-dvh">
        <div className="px-5 pt-6 pb-4">
          <div className="text-lg font-semibold tracking-tight">Finance</div>
          <div className="text-xs text-muted">Net worth & spending</div>
        </div>
        <div className="px-3">
          <button onClick={() => setQuickAdd(true)} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-accent text-[15px] font-medium text-white shadow-sm hover:brightness-110">
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
        <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3">
          {[...tabs.filter((t) => t.to !== '/more'), ...sidebarExtra].map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) =>
                cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors', isActive ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-text')
              }
            >
              <t.icon className="h-[18px] w-[18px]" />
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-3">
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

      <div className="flex min-h-dvh flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="pt-safe sticky top-0 z-30 bg-bg/85 backdrop-blur md:hidden">
          <div className="flex h-12 items-center justify-between px-4">
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

        {(!online || pending > 0) && (
          <div className={cn('mx-4 mt-1 flex items-center gap-2 rounded-xl px-3 py-2 text-xs md:mx-6 md:mt-4', online ? 'bg-accent-soft text-accent' : 'bg-warning-soft text-warning')}>
            {online ? <CloudUpload className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            {online ? `Syncing ${pending} change${pending === 1 ? '' : 's'}…` : `You're offline${pending ? ` · ${pending} change${pending === 1 ? '' : 's'} waiting to sync` : ''}`}
          </div>
        )}

        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-2 md:px-8 md:pb-10 md:pt-8">{children}</main>

        {/* Mobile FAB */}
        {!isMore && (
          <button
            onClick={() => setQuickAdd(true)}
            aria-label="Quick add"
            className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 active:scale-95 transition-transform md:hidden"
          >
            <Plus className="h-6 w-6" />
          </button>
        )}

        {/* Mobile tab bar */}
        <nav className="h-tabbar pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:hidden">
          <div className="grid h-16 grid-cols-5">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.to === '/'}
                className={({ isActive }) => cn('flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors', isActive ? 'text-accent' : 'text-faint')}
              >
                <t.icon className="h-[22px] w-[22px]" />
                {t.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>

      <QuickAddSheet open={quickAdd} onClose={() => setQuickAdd(false)} />
    </div>
  )
}
