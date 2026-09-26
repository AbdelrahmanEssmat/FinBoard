import { CloudUpload, WifiOff } from 'lucide-react'
import { cn } from '@/utils'

export function OfflineBanner({ online, pending }: { online: boolean; pending: number }) {
  if (online && pending === 0) return null
  const changes = `${pending} change${pending === 1 ? '' : 's'}`
  return (
    <div className={cn('mx-5 mt-2 flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs md:mx-10 md:mt-6', online ? 'bg-accent-soft text-accent' : 'bg-warning-soft text-warning')} role="status">
      {online ? <CloudUpload className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      {online ? `Syncing ${changes}…` : `You're offline${pending ? ` · ${changes} waiting to sync` : ''}`}
    </div>
  )
}
