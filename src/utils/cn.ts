import { twMerge } from 'tailwind-merge'

/**
 * Join class names, skipping falsy values, and let later Tailwind classes override
 * conflicting earlier ones (e.g. a component's `w-full` vs a caller's `w-32`).
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return twMerge(parts.filter(Boolean).join(' '))
}
