import { NavLink } from 'react-router-dom'
import { cn } from '@/utils'
import { TABS } from '@/layout/nav'

/** Phone-only bottom tab bar, padded for the iPhone home indicator. Sits at the bottom of the app frame. */
export function TabBar() {
  return (
    <nav className="h-tabbar pb-safe z-30 shrink-0 border-t border-border bg-surface/95 backdrop-blur md:hidden">
      <div className="grid h-[4.25rem] grid-cols-5">
        {TABS.map((t) => (
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
  )
}
