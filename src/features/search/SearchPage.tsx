import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Gem, HandCoins, Landmark, Percent, Search, TrendingUp, Users } from 'lucide-react'
import { Card, Divider, EmptyState, Input, ListRow, PageHeader, SectionTitle, Amount } from '@/components/ui'
import { useAccounts, useCategories, useCertificates, useContacts, useDebts, useGoldItems, useHoldings, useTransactions } from '@/lib/data/tables'
import { byId } from '@/lib/utils'
import { iconFor } from '@/lib/icons'
import { TransactionList } from '@/features/transactions/TransactionList'
import { TransactionForm } from '@/features/transactions/TransactionForm'
import type { Transaction } from '@/lib/database.types'
import { formatDate } from '@/domain/format'

export default function SearchPage() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Transaction | null>(null)
  const { data: txs } = useTransactions()
  const { data: accounts } = useAccounts()
  const { data: categories } = useCategories()
  const { data: certs } = useCertificates()
  const { data: holdings } = useHoldings()
  const { data: gold } = useGoldItems()
  const { data: debts } = useDebts()
  const { data: contacts } = useContacts()
  const catMap = useMemo(() => byId(categories), [categories])
  const contactMap = useMemo(() => byId(contacts), [contacts])

  const term = q.trim().toLowerCase()
  const match = (...parts: (string | number | null | undefined)[]) => parts.some((p) => p !== null && p !== undefined && String(p).toLowerCase().includes(term))

  const results = useMemo(() => {
    if (term.length < 2) return null
    return {
      transactions: (txs ?? []).filter((t) => match(t.payee, t.notes, t.amount, t.tags.join(' '), t.category_id ? catMap.get(t.category_id)?.name : '')).slice(0, 50),
      accounts: (accounts ?? []).filter((a) => match(a.name, a.notes)),
      certificates: (certs ?? []).filter((c) => match(c.name, c.notes)),
      holdings: (holdings ?? []).filter((h) => match(h.name, h.ticker, h.notes)),
      gold: (gold ?? []).filter((g) => match(g.name, g.notes, g.karat + 'k')),
      debts: (debts ?? []).filter((x) => match(contactMap.get(x.contact_id)?.name, x.reason, x.notes, x.amount)),
      contacts: (contacts ?? []).filter((c) => match(c.name, c.phone, c.notes)),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, txs, accounts, certs, holdings, gold, debts, contacts, catMap, contactMap])

  const total = results ? Object.values(results).reduce((a, r) => a + r.length, 0) : 0

  return (
    <div className="anim-fade-up">
      <PageHeader
        back={
          <button onClick={() => navigate(-1)} aria-label="Back" className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2">
            <ChevronLeft className="h-5 w-5" />
          </button>
        }
        title="Search"
      />
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search transactions, people, accounts, holdings…" className="mb-4 h-12" />
      {!results ? (
        <EmptyState icon={Search} title="Search everything" description="Type at least two characters." />
      ) : total === 0 ? (
        <EmptyState icon={Search} title="No matches" description={`Nothing found for “${q}”.`} />
      ) : (
        <div className="space-y-6">
          {results.accounts.length ? (
            <section>
              <SectionTitle>Accounts</SectionTitle>
              <Card className="overflow-hidden">
                {results.accounts.map((a, i) => (
                  <div key={a.id}>
                    {i > 0 ? <Divider /> : null}
                    <ListRow icon={iconFor(a.icon) ?? Landmark} color={a.color} title={a.name} chevron onClick={() => navigate(`/accounts/${a.id}`)} />
                  </div>
                ))}
              </Card>
            </section>
          ) : null}
          {results.debts.length || results.contacts.length ? (
            <section>
              <SectionTitle>People & debts</SectionTitle>
              <Card className="overflow-hidden">
                {results.debts.map((x, i) => (
                  <div key={x.id}>
                    {i > 0 ? <Divider /> : null}
                    <ListRow icon={HandCoins} color={x.direction === 'i_owe' ? '#dc2626' : '#16a34a'} title={contactMap.get(x.contact_id)?.name ?? ''} subtitle={`${x.direction === 'i_owe' ? 'I owe' : 'Owed to me'} · ${x.reason ?? formatDate(x.date)}`} trailing={<Amount value={x.amount} currency={x.currency} />} chevron onClick={() => navigate(`/debts/${x.id}`)} />
                  </div>
                ))}
                {results.contacts.filter((c) => !results.debts.some((x) => x.contact_id === c.id)).map((c) => (
                  <div key={c.id}>
                    <Divider />
                    <ListRow icon={Users} color="#ec4899" title={c.name} subtitle={c.phone ?? undefined} chevron onClick={() => navigate('/debts?tab=people')} />
                  </div>
                ))}
              </Card>
            </section>
          ) : null}
          {results.certificates.length ? (
            <section>
              <SectionTitle>Certificates</SectionTitle>
              <Card className="overflow-hidden">
                {results.certificates.map((c, i) => (
                  <div key={c.id}>
                    {i > 0 ? <Divider /> : null}
                    <ListRow icon={Percent} color="#eab308" title={c.name} subtitle={`${c.interest_rate}% · matures ${formatDate(c.maturity_date)}`} trailing={<Amount value={c.principal} currency={c.currency} />} chevron onClick={() => navigate(`/certificates/${c.id}`)} />
                  </div>
                ))}
              </Card>
            </section>
          ) : null}
          {results.holdings.length || results.gold.length ? (
            <section>
              <SectionTitle>Investments & gold</SectionTitle>
              <Card className="overflow-hidden">
                {results.holdings.map((h, i) => (
                  <div key={h.id}>
                    {i > 0 ? <Divider /> : null}
                    <ListRow icon={TrendingUp} color="#8b5cf6" title={h.name} subtitle={h.ticker ?? undefined} chevron onClick={() => navigate('/investments')} />
                  </div>
                ))}
                {results.gold.map((g) => (
                  <div key={g.id}>
                    <Divider />
                    <ListRow icon={Gem} color="#ca8a04" title={g.name || `${g.karat}K ${g.type}`} subtitle={`${g.weight_grams} g`} chevron onClick={() => navigate('/gold')} />
                  </div>
                ))}
              </Card>
            </section>
          ) : null}
          {results.transactions.length ? (
            <section>
              <SectionTitle>Transactions</SectionTitle>
              <TransactionList transactions={results.transactions} onSelect={setEdit} />
            </section>
          ) : null}
        </div>
      )}
      <TransactionForm open={Boolean(edit)} onClose={() => setEdit(null)} initial={edit} />
    </div>
  )
}
