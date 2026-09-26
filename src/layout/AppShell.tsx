import { useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useConnectivity } from '@/hooks/useConnectivity'
import { useDailyJobs } from '@/hooks/useDailyJobs'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'
import { useVisualViewport } from '@/hooks/useVisualViewport'
import { Sidebar } from '@/layout/Sidebar'
import { TopBar } from '@/layout/TopBar'
import { TabBar } from '@/layout/TabBar'
import { OfflineBanner } from '@/layout/OfflineBanner'
import { QuickAddSheet } from '@/layout/QuickAddSheet'

/**
 * Responsive frame: sidebar on desktop, top bar + bottom tabs + floating "+" on phones.
 * Also mounts the app-wide background hooks (realtime, connectivity, daily jobs).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [quickAdd, setQuickAdd] = useState(false)
  const { online, pending } = useConnectivity()
  const location = useLocation()
  // while typing on a phone, the tab bar and "+" would sit on top of the keyboard
  const { keyboardOpen } = useVisualViewport()
  useRealtimeSync()
  useDailyJobs()

  return (
    <div className="min-h-dvh md:flex">
      <Sidebar onQuickAdd={() => setQuickAdd(true)} />

      <div className="flex min-h-dvh flex-1 flex-col">
        <TopBar />
        <OfflineBanner online={online} pending={pending} />

        <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-3 md:px-10 md:pb-12 md:pt-10">{children}</main>

        {location.pathname !== '/more' && !keyboardOpen ? (
          <button
            onClick={() => setQuickAdd(true)}
            aria-label="Quick add"
            className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 transition-transform active:scale-95 md:hidden"
          >
            <Plus className="h-6 w-6" />
          </button>
        ) : null}

        {keyboardOpen ? null : <TabBar />}
      </div>

      <QuickAddSheet open={quickAdd} onClose={() => setQuickAdd(false)} />
    </div>
  )
}
