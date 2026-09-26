import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Repeat, SlidersHorizontal, X } from 'lucide-react'
import { Amount, PageHeader } from '@/components/shared'
import { Button, Card, Input, Select, Sheet, Skeleton } from '@/components/ui'
import { useAccounts, useCategories, useSubAccounts, useTransactions } from '@/api/queries'
import { useConvert } from '@/hooks/useMoney'
import { d } from '@/domain/money'
import { byId, endOfMonthIso, startOfMonthIso } from '@/utils'
import { TransactionList } from '@/features/transactions/components/TransactionList'
import { TransactionForm } from '@/features/transactions/components/TransactionForm'
import type { Transaction, TransactionType } from '@/api/database.types'

interface Filters {
  accountId: string
  categoryId: string
  type: '' | TransactionType
  tag: string
  text: string
}
const EMPTY: Filters = { accountId: '', categoryId: '', type: '', tag: '', text: '' }

export default function TransactionsPage() {
  const navigate = useNavigate()
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const from = startOfMonthIso(month)
  const to = endOfMonthIso(month)
  const { data, isLoading } = useTransactions({ from, to })
  const { data: accounts } = useAccounts()
  const { data: subs } = useSubAccounts()
  const { data: categories } = useCategories()
  const { toDisplayOrZero, display } = useConvert()
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [showFilters, setShowFilters] = useState(false)
  const [edit, setEdit] = useState<Transaction | null>(null)

  const subMap = useMemo(() => byId(subs), [subs])
  const catMap = useMemo(() => byId(categories), [categories])
  const activeFilters = Object.values(filters).filter(Boolean).length

  const filtered = useMemo(() => {
    const q = filters.text.trim().toLowerCase()
    return (data ?? []).filter((t) => {
      if (filters.type && t.type !== filters.type) return false
      if (filters.accountId) {
        const a1 = subMap.get(t.sub_account_id)?.account_id
        const a2 = t.to_sub_account_id ? subMap.get(t.to_sub_account_id)?.account_id : null
        if (a1 !== filters.accountId && a2 !== filters.accountId) return false
      }
      if (filters.categoryId) {
        const cat = t.category_id ? catMap.get(t.category_id) : null
        if (t.category_id !== filters.categoryId && cat?.parent_id !== filters.categoryId) return false
      }
      if (filters.tag && !t.tags.includes(filters.tag)) return false
      if (q) {
        const hay = [t.payee, t.notes, t.category_id ? catMap.get(t.category_id)?.name : '', ...t.tags, String(t.amount)].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data, filters, subMap, catMap])

  const totals = useMemo(() => {
    let income = d(0)
    let expense = d(0)
    for (const t of filtered) {
      if (t.type === 'income') income = income.plus(toDisplayOrZero(t.amount, t.currency))
      if (t.type === 'expense') expense = expense.plus(toDisplayOrZero(t.amount, t.currency))
    }
    return { income, expense }
  }, [filtered, toDisplayOrZero])

  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))
  const monthLabel = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const allTags = useMemo(() => Array.from(new Set((data ?? []).flatMap((t) => t.tags))).sort(), [data])

  return (
    <div className="anim-fade-up">
      <PageHeader
        title="Activity"
        action={
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" aria-label="Recurring" onClick={() => navigate('/recurring')}>
              <Repeat className="h-5 w-5" />
            </Button>
            <Button size="icon" variant={activeFilters ? 'soft' : 'ghost'} aria-label="Filters" onClick={() => setShowFilters(true)}>
              <SlidersHorizontal className="h-5 w-5" />
            </Button>
          </div>
        }
      />

      <Card className="mb-6 flex items-center justify-between p-2">
        <button onClick={() => shift(-1)} aria-label="Previous month" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <div className="text-[15px] font-semibold">{monthLabel}</div>
          <div className="flex gap-3 text-xs text-muted">
            <span>
              In <Amount value={totals.income} currency={display} size="sm" className="text-positive" />
            </span>
            <span>
              Out <Amount value={totals.expense} currency={display} size="sm" className="text-negative" />
            </span>
          </div>
        </div>
        <button onClick={() => shift(1)} aria-label="Next month" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-surface-2">
          <ChevronRight className="h-5 w-5" />
        </button>
      </Card>

      <div className="mb-4">
        <Input value={filters.text} onChange={(e) => setFilters({ ...filters, text: e.target.value })} placeholder="Search this month…" />
      </div>

      {activeFilters ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {filters.accountId ? <Chip label={accounts?.find((a) => a.id === filters.accountId)?.name ?? ''} onClear={() => setFilters({ ...filters, accountId: '' })} /> : null}
          {filters.categoryId ? <Chip label={catMap.get(filters.categoryId)?.name ?? ''} onClear={() => setFilters({ ...filters, categoryId: '' })} /> : null}
          {filters.type ? <Chip label={filters.type} onClear={() => setFilters({ ...filters, type: '' })} /> : null}
          {filters.tag ? <Chip label={'#' + filters.tag} onClear={() => setFilters({ ...filters, tag: '' })} /> : null}
        </div>
      ) : null}

      {isLoading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : (
        <TransactionList transactions={filtered} onSelect={setEdit} emptyText={activeFilters || filters.text ? 'No transactions match these filters.' : `Nothing recorded in ${monthLabel} yet.`} />
      )}

      <Sheet open={showFilters} onClose={() => setShowFilters(false)} title="Filters" footer={<div className="flex gap-3"><Button variant="secondary" size="lg" onClick={() => setFilters(EMPTY)}>Clear</Button><Button full size="lg" onClick={() => setShowFilters(false)}>Done</Button></div>}>
        <div className="space-y-5">
          <Select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value as Filters['type'] })}>
            <option value="">All types</option>
            <option value="expense">Expenses</option>
            <option value="income">Income</option>
            <option value="transfer">Transfers</option>
          </Select>
          <Select value={filters.accountId} onChange={(e) => setFilters({ ...filters, accountId: e.target.value })}>
            <option value="">All accounts</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}>
            <option value="">All categories</option>
            {categories?.filter((c) => !c.parent_id).map((c) => (
              <option key={c.id} value={c.id}>
                {c.kind === 'income' ? '↓ ' : '↑ '}
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })}>
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </Select>
        </div>
      </Sheet>
      <TransactionForm open={Boolean(edit)} onClose={() => setEdit(null)} initial={edit} />
    </div>
  )
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
      {label}
      <button onClick={onClear} aria-label="Remove filter">
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
