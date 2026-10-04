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
   * clouds = yield-bearing balances, investments = holdings only,
   * cards = what you owe on credit cards (positive; subtracted from the total),
   * receivables / liabilities = what people owe you / what you owe them: shown, but NOT in the total
   * (a debt counts when it is repaid and the money moves in or out of an account).
   */
  byClass: { accounts: Decimal; certificates: Decimal; clouds: Decimal; investments: Decimal; gold: Decimal; receivables: Decimal; liabilities: Decimal; cards: Decimal }
  /** value held in each original currency, expressed in base */
  byCurrency: Record<string, Decimal>
  /** what you own (debts people owe you are not included until they are repaid) */
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
  let cardBalances = new Decimal(0)
  for (const s of input.subAccounts) {
    if (s.is_archived || s.account?.is_archived) continue
    const v = conv(s.balance, s.currency)
    // a credit card balance is minus what you owe: debt, not a (negative) asset in that currency
    if (s.account?.type === 'credit_card') {
      cardBalances = cardBalances.plus(v)
      continue
    }
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

  // debts between people are records: reported here, but left out of the total until they are repaid
  let receivables = new Decimal(0)
  let liabilities = new Decimal(0)
  for (const debt of input.debts) {
    // open = not fully paid (the database's rule), so a debt changed on this device counts before the refetch
    const remaining = debtProgress({ amount: debt.amount }, input.paymentsByDebt[debt.id] ?? []).remaining
    if (remaining.lte(0)) continue
    const v = conv(remaining, debt.currency)
    if (debt.direction === 'owed_to_me') receivables = receivables.plus(v)
    else liabilities = liabilities.plus(v)
  }

  const assets = accounts.plus(certificates).plus(clouds).plus(investments).plus(gold)
  const cards = cardBalances.neg()
  return {
    total: assets.minus(cards),
    assets,
    byClass: { accounts, certificates, clouds, investments, gold, receivables, liabilities, cards },
    byCurrency,
  }
}
