import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Landmark, Plus } from 'lucide-react'
import { Amount, EmptyState, ListRow, PageHeader, SectionTitle } from '@/components/shared'
import { Button, Card, Divider, Skeleton } from '@/components/ui'
import { iconFor } from '@/utils/icons'
import { groupBy } from '@/utils'
import { ACCOUNT_TYPE_LABELS, useAccountsWithBalances, type AccountWithBalances } from '@/features/accounts/useAccountsWithBalances'
import { AccountForm } from '@/features/accounts/components/AccountForm'
import { CreditCardRow } from '@/features/accounts/components/CreditCardRow'
import { useCreditCards } from '@/hooks/useCreditCards'
import { d } from '@/domain/money'
import type { AccountType } from '@/api/database.types'

const ORDER: AccountType[] = ['bank', 'cash', 'wallet', 'investment', 'other']

export default function AccountsPage() {
  const { list, display, isLoading, isEmpty } = useAccountsWithBalances()
  const { cards, totals: cardTotals } = useCreditCards()
  // what you have in accounts; card debt is shown on its own, not netted into this
  const total = list.filter((a) => a.type !== 'credit_card').reduce((acc, a) => acc.plus(a.total), d(0))
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  const groups = groupBy(list, (a) => a.type)

  return (
    <div className="anim-fade-up">
      <PageHeader
        title="Accounts"
        subtitle={
          <span>
            Total <Amount value={total} currency={display} className="font-medium text-text" />
            {cardTotals.owed.gt(0) ? (
              <>
                {' · cards owe '}
                <Amount value={cardTotals.owed} currency={display} className="font-medium text-negative" />
              </>
            ) : null}
          </span>
        }
        action={
          <Button size="sm" variant="soft" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : isEmpty ? (
        <EmptyState icon={Landmark} title="Add your first account" description="Banks, cash on hand, wallets, credit cards and investment platforms. Each account can hold balances in several currencies." action={<Button onClick={() => setAdding(true)}>Add account</Button>} />
      ) : (
        <div className="space-y-8">
          {ORDER.filter((t) => groups[t]?.length).map((t) => (
            <section key={t}>
              <SectionTitle>{ACCOUNT_TYPE_LABELS[t]}</SectionTitle>
              <Card className="overflow-hidden">
                {groups[t]!.map((a, i) => (
                  <div key={a.id}>
                    {i > 0 ? <Divider /> : null}
                    <AccountRow account={a} onClick={() => navigate(`/accounts/${a.id}`)} />
                  </div>
                ))}
              </Card>
            </section>
          ))}
          {cards.length ? (
            <section>
              <SectionTitle>Credit cards</SectionTitle>
              <Card className="overflow-hidden">
                {cards.map((c, i) => (
                  <div key={c.account.id}>
                    {i > 0 ? <Divider /> : null}
                    <CreditCardRow card={c} onClick={() => navigate(`/accounts/${c.account.id}`)} />
                  </div>
                ))}
              </Card>
            </section>
          ) : null}
        </div>
      )}
      <AccountForm open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

function AccountRow({ account, onClick }: { account: AccountWithBalances; onClick: () => void }) {
  const { display } = useAccountsWithBalances()
  return (
    <ListRow
      icon={iconFor(account.icon)}
      color={account.color}
      title={account.name}
      // what the account holds, e.g. "EGP · USD" or "Cash balance · Daily Cloud"; amounts live on the right and in the detail page
      subtitle={account.subs.map((s) => s.name || s.currency).join(' · ') || undefined}
      trailing={<Amount value={account.total} currency={display} className="font-semibold" />}
      chevron
      onClick={onClick}
    />
  )
}
