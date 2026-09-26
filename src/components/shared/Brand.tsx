import { useId } from 'react'
import { cn } from '@/utils'

export const APP_SLOGAN = 'All your money, one board'

/** The app icon (same drawing as public/favicon.svg and the installed app icon). */
export function BrandMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 64 64" className={cn('shrink-0 drop-shadow-[0_6px_14px_rgba(43,92,230,0.35)]', className)} aria-hidden="true">
      <defs>
        <linearGradient id={`bg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b5ce6" />
          <stop offset="1" stopColor="#183496" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14.4" fill={`url(#bg-${id})`} />
      <circle cx="19.2" cy="19.2" r="7" fill="#ffc43d" />
      <circle cx="19.2" cy="19.2" r="4.9" fill="none" stroke="#d69614" strokeWidth="0.9" />
      <rect x="12.2" y="35.2" width="9.6" height="15.4" rx="2.2" fill="#fff" />
      <rect x="27.2" y="25.6" width="9.6" height="25" rx="2.2" fill="#fff" />
      <rect x="42.2" y="14.7" width="9.6" height="35.9" rx="2.2" fill="#fff" />
    </svg>
  )
}

/** Wordmark: "Fin" solid, "Board" in the brand gradient. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-bold leading-none tracking-[-0.03em]', className)}>
      Fin<span className="brand-gradient-text">Board</span>
    </span>
  )
}

/** Icon + name + slogan. `inline` for the sidebar, `stacked` (centred, larger) for the sign-in screen. */
export function Brand({ variant = 'inline', className }: { variant?: 'inline' | 'stacked'; className?: string }) {
  if (variant === 'stacked') {
    return (
      <div className={cn('flex flex-col items-center text-center', className)}>
        <BrandMark className="h-[72px] w-[72px]" />
        <Wordmark className="mt-5 text-[34px]" />
        <Slogan className="mt-3" />
      </div>
    )
  }
  // icon + name on one row, the slogan on its own line underneath so it never wraps
  return (
    <div className={cn('flex flex-col items-center text-center', className)}>
      <div className="flex items-center justify-center gap-3">
        <BrandMark className="h-10 w-10" />
        <Wordmark className="text-[24px]" />
      </div>
      <Slogan className="mt-3 whitespace-nowrap" />
    </div>
  )
}

function Slogan({ className }: { className?: string }) {
  return <div className={cn('text-[10.5px] font-semibold uppercase leading-none tracking-[0.14em] text-muted', className)}>{APP_SLOGAN}</div>
}
