import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, X } from 'lucide-react'
import { Card } from '@/components/ui'
import { useHoldings } from '@/api/queries'
import { d } from '@/domain/money'
import { isPriceFresh } from '@/domain/investments'
import { toIsoDate } from '@/utils/dates'
import { relativeTime } from '@/utils'

const DISMISS_KEY = 'finboard-prices-reminder-dismissed'

function dismissedToday(today: string): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === today
  } catch {
    return false
  }
}

/** Nudge on the home page when some stock or fund prices haven't been checked today. */
export function PricesReminder() {
  const navigate = useNavigate()
  const { data: holdings } = useHoldings()
  const today = toIsoDate(new Date())
  const [hidden, setHidden] = useState(() => dismissedToday(today))

  const open = (holdings ?? []).filter((h) => d(h.units).gt(0))
  const stale = open.filter((h) => !isPriceFresh(h.price_updated_at, today))
  if (hidden || !stale.length) return null
  const oldest = stale.map((h) => h.price_updated_at).sort()[0] ?? null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, today)
    } catch {
      /* private mode: just hide for now */
    }
    setHidden(true)
  }

  return (
    <Card className="anim-fade-up flex items-center gap-3 p-3 pl-4">
      <button type="button" onClick={() => navigate('/investments/prices')} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <RefreshCw className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium">Update today&apos;s prices</span>
          <span className="block truncate text-xs text-muted">
            {stale.length === open.length ? `${open.length} stock${open.length === 1 ? '' : 's'} & funds` : `${stale.length} of ${open.length} not checked`} · last {relativeTime(oldest)}
          </span>
        </span>
      </button>
      <button type="button" onClick={dismiss} aria-label="Remind me tomorrow" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-faint hover:bg-surface-2 hover:text-text">
        <X className="h-4 w-4" />
      </button>
    </Card>
  )
}
