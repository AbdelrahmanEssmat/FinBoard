import { useMemo } from 'react'
import { useAccounts, useSubAccounts } from '@/api/queries'
import { useConvert } from '@/hooks/useMoney'
import { computeLiquidity } from '@/domain/liquidity'

/** Money you can spend right now (bank, cash and wallet balances), per currency and per account. */
export function useLiquidity() {
  const accounts = useAccounts()
  const subs = useSubAccounts()
  const { display, rates } = useConvert()
  const result = useMemo(() => computeLiquidity(accounts.data ?? [], subs.data ?? [], display, rates), [accounts.data, subs.data, display, rates])
  return { ...result, display, isLoading: (accounts.isLoading && !accounts.data) || (subs.isLoading && !subs.data) }
}
