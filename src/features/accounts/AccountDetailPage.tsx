import { createElement, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { Amount, ListRow, PageHeader, SectionTitle } from '@/components/shared'
import { Button, Card, ConfirmDialog, Divider, Sheet } from '@/components/ui'
import { useAccounts, useCertificates, useSubAccounts, useTransactions } from '@/api/queries'
import { useUndoableDelete } from '@/api/mutations'
import { iconFor } from '@/utils/icons'
import { useConvert } from '@/hooks/useMoney'
import { d } from '@/domain/money'
import { AccountForm } from '@/features/accounts/components/AccountForm'
import { SubAccountForm } from '@/features/accounts/components/SubAccountForm'
import { TransactionList } from '@/features/transactions/components/TransactionList'
import { TransactionForm } from '@/features/transactions/components/TransactionForm'
import type { SubAccount, Transaction } from '@/api/database.types'
import { formatDate } from '@/domain/format'

export default function AccountDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: accounts } = useAccounts()
  const { data: subs } = useSubAccounts()
  const { data: certs } = useCertificates()
  const { toDisplayOrZero, display } = useConvert()
  const account = accounts?.find((a) => a.id === id)
  const mySubs = useMemo(() => (subs ?? []).filter((s) => s.account_id === id), [subs, id])
  const myCerts = useMemo(() => (certs ?? []).filter((c) => c.account_id === id && !c.is_closed), [certs, id])
  const total = mySubs.filter((s) => !s.is_archived).reduce((a, s) => a.plus(toDisplayOrZero(s.balance, s.currency)), d(0))
  const certTotal = myCerts.reduce((a, c) => a.plus(toDisplayOrZero(c.principal, c.currency)), d(0))

  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [subForm, setSubForm] = useState<{ open: boolean; sub?: SubAccount | null }>({ open: false })
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const deleteAccount = useUndoableDelete('accounts', { invalidate: ['sub_accounts', 'transactions'], label: 'Account' })
  const deleteSub = useUndoableDelete('sub_accounts', { invalidate: ['transactions'], label: 'Balance' })

  const { data: txs } = useTransactions()
  const recent = useMemo(() => {
    const ids = new Set(mySubs.map((s) => s.id))
    return (txs ?? []).filter((t) => ids.has(t.sub_account_id) || (t.to_sub_account_id && ids.has(t.to_sub_account_id))).slice(0, 30)
  }, [txs, mySubs])

  if (!account) return <div className="py-12 text-center text-muted">Account not found</div>

  return (
    <div className="anim-fade-up">
      <PageHeader
        back
        title={account.name}
        action={
          <Button size="icon" variant="ghost" onClick={() => setMenu(true)} aria-label="More">
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        }
      />

      <Card padded className="mb-8">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl text-white" style={{ background: account.color }}>
            {createElement(iconFor(account.icon), { className: 'h-6 w-6' })}
          </span>
          <div>
            <div className="text-xs text-muted">Balance</div>
            <Amount value={total} currency={display} size="lg" />
            {myCerts.length ? (
              <div className="text-xs text-muted">
                + <Amount value={certTotal} currency={display} size="sm" /> in certificates
              </div>
            ) : null}
          </div>
        </div>
        {account.notes ? <p className="mt-3 text-sm text-muted">{account.notes}</p> : null}
      </Card>

      <SectionTitle
        action={
          <button onClick={() => setSubForm({ open: true, sub: null })} className="flex items-center gap-1 text-xs font-medium text-accent">
            <Plus className="h-3.5 w-3.5" /> Currency
          </button>
        }
      >
        Balances
      </SectionTitle>
      <Card className="mb-8 overflow-hidden">
        {mySubs.map((s, i) => (
          <div key={s.id}>
            {i > 0 ? <Divider /> : null}
            <ListRow
              title={
                <span>
                  {s.currency}
                  {s.name ? <span className="text-muted"> · {s.name}</span> : null}
                  {s.is_archived ? <span className="ml-2 text-xs text-faint">archived</span> : null}
                </span>
              }
              subtitle={s.currency !== display ? <Amount value={toDisplayOrZero(s.balance, s.currency)} currency={display} size="sm" /> : undefined}
              trailing={<Amount value={s.balance} currency={s.currency} className="font-semibold" />}
              onClick={() => setSubForm({ open: true, sub: s })}
            />
          </div>
        ))}
        {!mySubs.length ? <p className="p-5 text-sm text-muted">No balances yet. Add a currency.</p> : null}
      </Card>

      {myCerts.length ? (
        <>
          <SectionTitle>Certificates</SectionTitle>
          <Card className="mb-8 overflow-hidden">
            {myCerts.map((c, i) => (
              <div key={c.id}>
                {i > 0 ? <Divider /> : null}
                <ListRow title={c.name} subtitle={`${c.interest_rate}% · matures ${formatDate(c.maturity_date)}`} trailing={<Amount value={c.principal} currency={c.currency} className="font-semibold" />} chevron onClick={() => navigate(`/certificates/${c.id}`)} />
              </div>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>Recent activity</SectionTitle>
      <TransactionList transactions={recent} onSelect={setEditTx} emptyText="No transactions for this account yet." />

      <Sheet open={menu} onClose={() => setMenu(false)} title={account.name}>
        <div className="space-y-1 pb-3">
          <button onClick={() => { setMenu(false); setEditing(true) }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-surface-2">
            <Pencil className="h-4 w-4 text-muted" /> Edit account
          </button>
          <button onClick={() => { setMenu(false); setConfirm(true) }} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-negative hover:bg-surface-2">
            <Trash2 className="h-4 w-4" /> Delete account
          </button>
        </div>
      </Sheet>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this account?"
        message="All its balances and transactions will be deleted too. You can undo for a few seconds."
        onConfirm={() => {
          deleteAccount(account)
          navigate('/accounts')
        }}
      />
      <AccountForm open={editing} onClose={() => setEditing(false)} initial={account} />
      <SubAccountForm
        open={subForm.open}
        onClose={() => setSubForm({ open: false })}
        accountId={account.id}
        initial={subForm.sub ?? null}
        onDelete={subForm.sub ? () => deleteSub(subForm.sub!) : undefined}
      />
      <TransactionForm open={Boolean(editTx)} onClose={() => setEditTx(null)} initial={editTx} />
    </div>
  )
}
