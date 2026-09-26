import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Landmark, Plus } from 'lucide-react'
import { Amount, EmptyState, ListRow, PageHeader, SectionTitle } from '@/components/shared'
import { Button, Card, Divider, Skeleton } from '@/components/ui'
import { iconFor } from '@/utils/icons'
import { groupBy } from '@/utils'
import { ACCOUNT_TYPE_LABELS, useAccountsWithBalances, type AccountWithBalances } from '@/features/accounts/useAccountsWithBalances'
import { AccountForm } from '@/features/accounts/components/AccountForm'
import type { AccountType } from '@/api/database.types'

const ORDER: AccountType[] = ['bank', 'cash', 'wallet', 'investment', 'other']

export default function AccountsPage() {
  const { list, grandTotal, display, isLoading, isEmpty } = useAccountsWithBalances()
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  const groups = groupBy(list, (a) => a.type)

  return (
    <div className="anim-fade-up">
      <PageHeader
        title="Accounts"
        subtitle={
          <span>
            Total <Amount value={grandTotal} currency={display} className="font-medium text-text" />
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
        <EmptyState icon={Landmark} title="Add your first account" description="Banks, cash on hand, wallets and investment platforms. Each account can hold balances in several currencies." action={<Button onClick={() => setAdding(true)}>Add account</Button>} />
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
        </div>
      )}
      <AccountForm open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

function AccountRow({ account, onClick }: { account: AccountWithBalances; onClick: () => void }) {
  const { display } = useAccountsWithBalances()
  const multi = account.subs.length > 1 || (account.subs[0] && account.subs[0].currency !== display)
  return (
    <ListRow
      icon={iconFor(account.icon)}
      color={account.color}
      title={account.name}
      subtitle={
        multi ? (
          <span className="flex flex-wrap gap-x-2">
            {account.subs.map((s) => (
              <Amount key={s.id} value={s.balance} currency={s.currency} size="sm" />
            ))}
          </span>
        ) : undefined
      }
      trailing={<Amount value={account.total} currency={display} className="font-semibold" />}
      chevron
      onClick={onClick}
    />
  )
}
