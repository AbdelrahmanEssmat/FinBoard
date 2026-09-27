/**
 * Liquidity: money you can spend right now.
 *
 * Counted: every active balance in a Bank, Cash or Wallet / prepaid card account.
 * Not counted: Clouds (yield balances, even inside a bank account), cash on investment platforms,
 * "Other" accounts, and of course certificates, holdings, gold and money owed to you (those aren't
 * account balances at all). Each currency is kept separately and also converted to one total.
 */
import { convertOrZero, type RateTable } from '@/domain/currency'
import { d, Decimal, type NumericInput } from '@/domain/money'

export const LIQUID_ACCOUNT_TYPES = ['bank', 'cash', 'wallet'] as const
export type LiquidType = (typeof LIQUID_ACCOUNT_TYPES)[number]

export interface LiquidAccountLike {
  id: string
  name: string
  type: string
  color: string
  icon: string
  is_archived: boolean
}
export interface LiquidSubLike {
  id: string
  account_id: string
  currency: string
  balance: NumericInput
  name?: string | null
  is_archived: boolean
  yield_rate?: NumericInput | null
}

export const isLiquidType = (type: string): type is LiquidType => (LIQUID_ACCOUNT_TYPES as readonly string[]).includes(type)
const isCloud = (s: LiquidSubLike) => s.yield_rate !== null && s.yield_rate !== undefined

export interface CurrencyAmount {
  currency: string
  /** in the currency itself */
  amount: Decimal
  /** converted to the base currency */
  base: Decimal
  pct: number
}
export interface LiquidAccount {
  id: string
  name: string
  type: LiquidType
  color: string
  icon: string
  balances: { subId: string; label: string | null; currency: string; amount: Decimal }[]
  base: Decimal
  pct: number
}
export interface Liquidity {
  total: Decimal
  byCurrency: CurrencyAmount[]
  byAccount: LiquidAccount[]
  byType: Record<LiquidType, Decimal>
  /** balances left out on purpose, so the page can say what isn't counted */
  excluded: { clouds: Decimal; platforms: Decimal; other: Decimal }
}

export function computeLiquidity(accounts: LiquidAccountLike[], subs: LiquidSubLike[], base: string, rates: RateTable): Liquidity {
  const conv = (amount: NumericInput, cur: string) => convertOrZero(amount, cur, base, rates)
  const accById = new Map(accounts.map((a) => [a.id, a]))
  const byCur = new Map<string, { amount: Decimal; base: Decimal }>()
  const byAcc = new Map<string, LiquidAccount>()
  const byType: Record<LiquidType, Decimal> = { bank: d(0), cash: d(0), wallet: d(0) }
  const excluded = { clouds: d(0), platforms: d(0), other: d(0) }
  let total = d(0)

  for (const s of subs) {
    const acc = accById.get(s.account_id)
    if (!acc || acc.is_archived || s.is_archived) continue
    const v = conv(s.balance, s.currency)
    if (isCloud(s)) {
      excluded.clouds = excluded.clouds.plus(v)
      continue
    }
    if (!isLiquidType(acc.type)) {
      if (acc.type === 'investment') excluded.platforms = excluded.platforms.plus(v)
      else excluded.other = excluded.other.plus(v)
      continue
    }
    total = total.plus(v)
    byType[acc.type] = byType[acc.type].plus(v)
    const cur = byCur.get(s.currency) ?? { amount: d(0), base: d(0) }
    byCur.set(s.currency, { amount: cur.amount.plus(d(s.balance)), base: cur.base.plus(v) })
    const row = byAcc.get(acc.id) ?? { id: acc.id, name: acc.name, type: acc.type, color: acc.color, icon: acc.icon, balances: [], base: d(0), pct: 0 }
    row.balances.push({ subId: s.id, label: s.name ?? null, currency: s.currency, amount: d(s.balance) })
    row.base = row.base.plus(v)
    byAcc.set(acc.id, row)
  }

  const pct = (v: Decimal) => (total.gt(0) ? v.div(total).times(100).toNumber() : 0)
  return {
    total,
    byCurrency: [...byCur.entries()].map(([currency, c]) => ({ currency, amount: c.amount, base: c.base, pct: pct(c.base) })).sort((a, b) => b.base.comparedTo(a.base)),
    byAccount: [...byAcc.values()].map((a) => ({ ...a, pct: pct(a.base) })).sort((a, b) => b.base.comparedTo(a.base)),
    byType,
    excluded,
  }
}

export const LIQUID_TYPE_LABELS: Record<LiquidType, string> = { bank: 'Banks', cash: 'Cash', wallet: 'Wallets & prepaid cards' }
