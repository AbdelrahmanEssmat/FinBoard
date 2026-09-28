import { useState, type InputHTMLAttributes } from 'react'
import { Check, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/utils'
import { passwordChecks } from './password'

/** A password input with a show/hide button. */
export function PasswordInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false)
  // one bordered box holding the text and the button side by side (the button never covers the text)
  return (
    <div
      className={cn(
        'flex h-12 w-full items-center rounded-xl border border-border bg-surface transition-shadow',
        'focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40',
        className,
      )}
    >
      <input
        {...rest}
        type={shown ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        // 16px on phones: anything smaller makes iOS zoom the page when a field is focused
        className="h-full min-w-0 flex-1 rounded-l-xl bg-transparent pl-4 text-[16px] text-text placeholder:text-faint focus:outline-none disabled:opacity-60 sm:text-[15px]"
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        className="flex h-full w-12 shrink-0 items-center justify-center rounded-r-xl text-faint hover:text-text"
      >
        {shown ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
      </button>
    </div>
  )
}

/** What a new password still needs, ticking off as the person types. */
export function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1" aria-label="Password requirements">
      {passwordChecks(password).map((c) => (
        <li key={c.id} className={cn('flex min-w-0 items-center gap-1.5 text-xs transition-colors', c.ok ? 'text-positive' : 'text-faint')}>
          <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border', c.ok ? 'border-positive bg-positive text-white' : 'border-border')}>
            {c.ok ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
          </span>
          <span className="min-w-0">{c.label}</span>
          <span className="sr-only">{c.ok ? '(done)' : '(missing)'}</span>
        </li>
      ))}
    </ul>
  )
}
