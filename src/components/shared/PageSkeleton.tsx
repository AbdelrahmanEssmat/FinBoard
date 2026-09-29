import { Skeleton } from '@/components/ui'
import { BackButton } from '@/components/shared/BackButton'

/** What a page shows while its data is still on its way: a way back, then three grey blocks. */
export function PageSkeleton({ back }: { back?: boolean }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      {back ? <BackButton /> : null}
      <Skeleton className="h-24" />
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  )
}
