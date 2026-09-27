import { useMemo } from 'react'
import { useAccounts } from '@/api/queries'
import { byId } from '@/utils'
import { BALANCE_GROUPS, balanceLabel } from '@/features/accounts/accountLabels'
import type { SubAccount } from '@/api/database.types'

/**
 * The <option>s for choosing a balance, grouped by kind of account (Bank accounts, Cash, Wallets &
 * prepaid cards, Credit cards, …) so a card can never be mistaken for a bank balance. Put inside a
 * <Select>; groups with nothing in them are left out.
 */
export function BalanceOptions({ subs }: { subs: SubAccount[] }) {
  const { data: accounts } = useAccounts()
  const accMap = useMemo(() => byId(accounts), [accounts])
  return (
    <>
      {BALANCE_GROUPS.map((g) => {
        const inGroup = subs.filter((s) => (accMap.get(s.account_id)?.type ?? 'other') === g.type)
        if (!inGroup.length) return null
        return (
          <optgroup key={g.type} label={g.label}>
            {inGroup.map((s) => (
              <option key={s.id} value={s.id}>
                {balanceLabel(s, accMap)}
              </option>
            ))}
          </optgroup>
        )
      })}
    </>
  )
}
