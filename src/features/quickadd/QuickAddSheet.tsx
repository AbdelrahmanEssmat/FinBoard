import { useState } from 'react'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, HandCoins } from 'lucide-react'
import { Sheet } from '@/components/ui'
import { TransactionForm } from '@/features/transactions/TransactionForm'
import { DebtPaymentForm } from '@/features/debts/DebtPaymentForm'
import type { TransactionType } from '@/lib/database.types'

export function QuickAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [txType, setTxType] = useState<TransactionType | null>(null)
  const [debtPay, setDebtPay] = useState(false)

  const pick = (t: TransactionType) => {
    onClose()
    setTxType(t)
  }
  const options = [
    { label: 'Expense', icon: ArrowUpRight, color: '#dc2626', onClick: () => pick('expense') },
    { label: 'Income', icon: ArrowDownLeft, color: '#16a34a', onClick: () => pick('income') },
    { label: 'Transfer', icon: ArrowLeftRight, color: '#2563eb', onClick: () => pick('transfer') },
    { label: 'Debt payment', icon: HandCoins, color: '#f97316', onClick: () => { onClose(); setDebtPay(true) } },
  ]
  return (
    <>
      <Sheet open={open} onClose={onClose} title="Add">
        <div className="grid grid-cols-2 gap-3 pb-2">
          {options.map((o) => (
            <button key={o.label} onClick={o.onClick} className="flex flex-col items-start gap-3 rounded-2xl bg-surface-2 p-4 text-left transition-transform active:scale-[0.98]">
              <span className="flex h-10 w-10 items-center justify-center rounded-full text-white" style={{ background: o.color }}>
                <o.icon className="h-5 w-5" />
              </span>
              <span className="text-[15px] font-medium">{o.label}</span>
            </button>
          ))}
        </div>
      </Sheet>
      <TransactionForm open={txType !== null} onClose={() => setTxType(null)} defaultType={txType ?? 'expense'} />
      <DebtPaymentForm open={debtPay} onClose={() => setDebtPay(false)} />
    </>
  )
}
