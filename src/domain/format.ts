import { format as dfFormat, parseISO, isValid } from 'date-fns'
import { d, type NumericInput } from './money'

export interface CurrencyMeta {
  code: string
  symbol: string
  decimals: number
}

const FALLBACK: Record<string, CurrencyMeta> = {
  EGP: { code: 'EGP', symbol: 'E£', decimals: 2 },
  USD: { code: 'USD', symbol: '$', decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', decimals: 2 },
  SAR: { code: 'SAR', symbol: 'SR', decimals: 2 },
  AED: { code: 'AED', symbol: 'AED', decimals: 2 },
  GBP: { code: 'GBP', symbol: '£', decimals: 2 },
}

export function currencyMeta(code: string, list?: CurrencyMeta[]): CurrencyMeta {
  return list?.find((c) => c.code === code) ?? FALLBACK[code] ?? { code, symbol: code, decimals: 2 }
}

/** 1,234,567.89 with thousand separators. */
export function formatNumber(value: NumericInput, decimals = 2, options: { compact?: boolean } = {}): string {
  const n = d(value)
  if (options.compact && n.abs().gte(1_000_000)) {
    return n.div(1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M'
  }
  const fixed = n.toFixed(decimals)
  const [int, frac] = fixed.split('.')
  const neg = int!.startsWith('-')
  const digits = neg ? int!.slice(1) : int!
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (neg ? '-' : '') + grouped + (frac ? '.' + frac : '')
}

export interface FormatMoneyOptions {
  decimals?: number
  showSign?: boolean
  compact?: boolean
  currencies?: CurrencyMeta[]
  symbolStyle?: 'symbol' | 'code' | 'none'
}

/** "E£ 12,345.00" / "$ 1,200.50" / "+E£ 500.00" */
export function formatMoney(value: NumericInput, currency: string, opts: FormatMoneyOptions = {}): string {
  const meta = currencyMeta(currency, opts.currencies)
  const n = d(value)
  const decimals = opts.decimals ?? meta.decimals
  const body = formatNumber(n.abs(), decimals, { compact: opts.compact })
  const sign = n.isNegative() ? '-' : opts.showSign && n.gt(0) ? '+' : ''
  const style = opts.symbolStyle ?? 'symbol'
  if (style === 'none') return sign + body
  if (style === 'code') return `${sign}${body} ${meta.code}`
  return `${sign}${meta.symbol} ${body}`
}

/** DD/MM/YYYY */
export function formatDate(iso: string | Date | null | undefined, pattern = 'dd/MM/yyyy'): string {
  if (!iso) return ''
  const date = typeof iso === 'string' ? parseISO(iso) : iso
  return isValid(date) ? dfFormat(date, pattern) : ''
}

export function todayIso(): string {
  return dfFormat(new Date(), 'yyyy-MM-dd')
}

export function formatPercent(value: NumericInput, decimals = 1): string {
  const n = d(value)
  return (n.gt(0) ? '+' : '') + n.toFixed(decimals) + '%'
}
