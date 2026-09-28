import type { Account, AccountType, SubAccount } from '@/api/database.types'

/**
 * How a credit card is named everywhere: "NBE credit card", or "NBE Visa" when its own name already
 * says more. When it's linked to its bank and the card's name doesn't mention the bank, the bank
 * name goes first ("CIB Platinum" → "CIB · Platinum").
 */
export function cardName(card: Pick<Account, 'name' | 'bank_account_id'>, accounts: Map<string, Pick<Account, 'name'>>): string {
  const bank = card.bank_account_id ? accounts.get(card.bank_account_id) : undefined
  const name = bank && !card.name.toLowerCase().includes(bank.name.toLowerCase()) ? `${bank.name} · ${card.name}` : card.name
  return /card|visa|master|amex|meeza/i.test(name) ? name : `${name} credit card`
}

/** The name of an account as it reads in lists ("NBE", "Cash", "NBE credit card"). */
export function accountDisplayName(account: Account | undefined, accounts: Map<string, Account>): string {
  if (!account) return 'Account'
  return account.type === 'credit_card' ? cardName(account, accounts) : account.name
}

/** One balance in a picker: "NBE · EGP · Savings", or "NBE credit card · EGP" for a card (listed under Credit cards). */
export function balanceLabel(sub: SubAccount, accounts: Map<string, Account>): string {
  const account = accounts.get(sub.account_id)
  const extra = sub.name ? ` · ${sub.name}` : ''
  if (account?.type === 'credit_card') return `${cardName(account, accounts)} · ${sub.currency}${extra}`
  return `${account?.name ?? 'Account'} · ${sub.currency}${extra}`
}

/** Picker groups, in the order they appear. */
export const BALANCE_GROUPS: { type: AccountType; label: string }[] = [
  { type: 'bank', label: 'Bank accounts' },
  { type: 'cash', label: 'Cash' },
  { type: 'wallet', label: 'Wallets & prepaid cards' },
  { type: 'credit_card', label: 'Credit cards' },
  { type: 'investment', label: 'Investment platforms' },
  { type: 'other', label: 'Other' },
]
