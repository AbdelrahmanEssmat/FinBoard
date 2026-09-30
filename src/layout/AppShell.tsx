import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { useConnectivity } from '@/hooks/useConnectivity'
import { useDailyJobs } from '@/hooks/useDailyJobs'
import { useMarketData } from '@/hooks/useMarketData'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'
import { useVisualViewport } from '@/hooks/useVisualViewport'
import { Sidebar } from '@/layout/Sidebar'
import { TopBar } from '@/layout/TopBar'
import { TabBar } from '@/layout/TabBar'
import { OfflineBanner } from '@/layout/OfflineBanner'
import { QuickAddSheet } from '@/layout/QuickAddSheet'

/** The element the page scrolls in on phones (the document itself scrolls on desktop). */
export const PAGE_SCROLLER_ID = 'page'

/**
 * Responsive frame: sidebar on desktop, top bar + bottom tabs + floating "+" on phones.
 *
 * On phones the whole app is one frame the height of the screen (see --app-height) and the page
 * scrolls inside it; the tab bar and the "+" are part of the frame, never pinned to the browser's
 * idea of the viewport bottom, which iPhone home-screen apps get wrong after the keyboard.
 * Also mounts the app-wide background hooks (realtime, connectivity, daily jobs, rates and gold prices).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [quickAdd, setQuickAdd] = useState(false)
  const { online, pending } = useConnectivity()
  const location = useLocation()
  // while typing on a phone, the tab bar and "+" would sit on top of the keyboard
  const { keyboardOpen } = useVisualViewport()
  useRealtimeSync()
  useDailyJobs()
  useMarketData()

  // a new page starts at its top (switching tabs used to keep the previous page's scroll position)
  useEffect(() => {
    document.getElementById(PAGE_SCROLLER_ID)?.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div className="h-app fixed inset-x-0 top-0 flex flex-col overflow-hidden md:static md:h-auto md:min-h-dvh md:flex-row md:overflow-visible">
      <Sidebar onQuickAdd={() => setQuickAdd(true)} />

      <div className="relative flex min-h-0 flex-1 flex-col md:min-h-dvh">
        <TopBar />
        <OfflineBanner online={online} pending={pending} />

        <main id={PAGE_SCROLLER_ID} className="min-h-0 flex-1 overflow-y-auto overscroll-contain md:overflow-visible">
          <div className="mx-auto w-full max-w-3xl px-5 pb-28 pt-4 md:px-10 md:pb-12 md:pt-10">{children}</div>
        </main>

        {/* the floating "+" lives on the home page only; other pages have their own add buttons */}
        {location.pathname === '/' && !keyboardOpen ? (
          <button
            onClick={() => setQuickAdd(true)}
            aria-label="Quick add"
            className="absolute bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent-strong text-white shadow-lg shadow-accent-strong/30 transition-transform active:scale-95 md:hidden"
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
