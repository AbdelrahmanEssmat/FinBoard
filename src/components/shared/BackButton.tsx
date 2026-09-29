import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/utils'

/** Goes to `to`, else back in history; on a fresh open of a deep link (nothing to go back to) it goes home instead of leaving the app. */
export function BackButton({ className, to }: { className?: string; to?: string }) {
  const navigate = useNavigate()
  const goBack = () => {
    if (to) return navigate(to)
    // the router records the position in history.state: 0 means this page is the first one opened
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/', { replace: true })
  }
  return (
    <button onClick={goBack} aria-label="Back" className={cn('-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2', className)}>
      <ChevronLeft className="h-5 w-5" />
    </button>
  )
}
