import { convertOrZero, type RateTable } from '@/domain/currency'
import { d, Decimal, type NumericInput } from '@/domain/money'
import { goldItemValue, type GoldItemLike, type GoldPriceTable } from '@/domain/gold'
import { debtProgress, type PaymentLike } from '@/domain/installments'

export interface SubAccountLike {
  id: string
  currency: string
  balance: NumericInput
  is_archived: boolean
  /** set for Clouds (yield-bearing balances), which get their own class */
  yield_rate?: NumericInput | null
  account?: { is_archived: boolean; type: string } | null
}
export interface CertificateLike {
  principal: NumericInput
  currency: string
  is_closed: boolean
}
export interface HoldingLike {
  units: NumericInput
  current_price: NumericInput
  currency: string
}
export interface DebtLikeNW {
  id: string
  direction: 'i_owe' | 'owed_to_me'
  amount: NumericInput
  currency: string
  status: 'open' | 'settled'
}

export interface NetWorthInput {
  base: string
  rates: RateTable
  subAccounts: SubAccountLike[]
  certificates: CertificateLike[]
  holdings: HoldingLike[]
  gold: GoldItemLike[]
  goldPrices: GoldPriceTable
  debts: DebtLikeNW[]
  paymentsByDebt: Record<string, PaymentLike[]>
}

export interface NetWorthResult {
  total: Decimal
  /**
   * accounts = cash and bank balances (including uninvested cash on a platform such as Thndr),
   * clouds = yield-bearing balances, investments = holdings only.
   */
  byClass: { accounts: Decimal; certificates: Decimal; clouds: Decimal; investments: Decimal; gold: Decimal; receivables: Decimal; liabilities: Decimal }
  /** value held in each original currency, expressed in base */
  byCurrency: Record<string, Decimal>
  assets: Decimal
}

/** Mirrors public.compute_net_worth in the database. */
export function computeNetWorth(input: NetWorthInput): NetWorthResult {
  const { base, rates } = input
  const byCurrency: Record<string, Decimal> = {}
  const add = (cur: string, v: Decimal) => {
    byCurrency[cur] = (byCurrency[cur] ?? new Decimal(0)).plus(v)
  }
  const conv = (amount: NumericInput, cur: string) => convertOrZero(amount, cur, base, rates)

  let accounts = new Decimal(0)
  let clouds = new Decimal(0)
  let investments = new Decimal(0)
  for (const s of input.subAccounts) {
    if (s.is_archived || s.account?.is_archived) continue
    const v = conv(s.balance, s.currency)
    if (s.yield_rate !== null && s.yield_rate !== undefined) clouds = clouds.plus(v)
    else accounts = accounts.plus(v)
    add(s.currency, v)
  }

  let certificates = new Decimal(0)
  for (const c of input.certificates) {
    if (c.is_closed) continue
    const v = conv(c.principal, c.currency)
    certificates = certificates.plus(v)
    add(c.currency, v)
  }

  for (const h of input.holdings) {
    const v = conv(d(h.units).times(d(h.current_price)), h.currency)
    investments = investments.plus(v)
    add(h.currency, v)
  }

  let gold = new Decimal(0)
  for (const g of input.gold) {
    const egp = goldItemValue(g, input.goldPrices)
    if (!egp) continue
    const v = conv(egp, 'EGP')
    gold = gold.plus(v)
    add('EGP', v)
  }

  let receivables = new Decimal(0)
  let liabilities = new Decimal(0)
  for (const debt of input.debts) {
    if (debt.status !== 'open') continue
    const remaining = debtProgress({ amount: debt.amount }, input.paymentsByDebt[debt.id] ?? []).remaining
    const v = conv(remaining, debt.currency)
    if (debt.direction === 'owed_to_me') receivables = receivables.plus(v)
    else liabilities = liabilities.plus(v)
  }

  const assets = accounts.plus(certificates).plus(clouds).plus(investments).plus(gold).plus(receivables)
  return {
    total: assets.minus(liabilities),
    assets,
    byClass: { accounts, certificates, clouds, investments, gold, receivables, liabilities },
    byCurrency,
  }
}
