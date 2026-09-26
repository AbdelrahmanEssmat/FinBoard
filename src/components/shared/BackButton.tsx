import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/utils'

export function BackButton({ className, to }: { className?: string; to?: string }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => (to ? navigate(to) : navigate(-1))}
      aria-label="Back"
      className={cn('-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2', className)}
    >
      <ChevronLeft className="h-5 w-5" />
    </button>
  )
}
