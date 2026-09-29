import { SearchX } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'

/** A detail page whose record doesn't exist (deleted, or a stale link): says so and keeps a way back. */
export function NotFound({ title }: { title: string }) {
  return (
    <div className="anim-fade-up">
      <PageHeader back title="Not found" />
      <EmptyState icon={SearchX} title={title} description="It may have been deleted, or the link is out of date." />
    </div>
  )
}
