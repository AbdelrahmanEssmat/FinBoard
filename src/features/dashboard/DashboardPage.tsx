import { Skeleton } from '@/components/ui'
import { useNetWorth } from '@/hooks/useNetWorth'
import { useRateTable } from '@/hooks/useMoney'
import { useNetWorthHistory } from '@/features/dashboard/useNetWorthHistory'
import { NetWorthCard } from '@/features/dashboard/components/NetWorthCard'
import { BreakdownCard } from '@/features/dashboard/components/BreakdownCard'
import { SetupCard } from '@/features/dashboard/components/SetupCard'
import { MonthSummary } from '@/features/dashboard/components/MonthSummary'
import { UpcomingList } from '@/features/dashboard/components/UpcomingList'

export default function DashboardPage() {
  const nw = useNetWorth()
  const { updatedAt } = useRateTable()
  const { history, change } = useNetWorthHistory(nw.total)

  if (nw.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-44" />
        <Skeleton className="h-28" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  const empty = nw.assets.isZero() && nw.byClass.liabilities.isZero()

  return (
    <div className="anim-fade-up space-y-8">
      <NetWorthCard total={nw.total} change={change} history={history} display={nw.display} ratesUpdatedAt={updatedAt} />
      {empty ? <SetupCard /> : <BreakdownCard nw={nw} display={nw.display} />}
      <MonthSummary />
      <UpcomingList />
    </div>
  )
}
