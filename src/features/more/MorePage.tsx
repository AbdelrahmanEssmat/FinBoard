import { useNavigate } from 'react-router-dom'
import { Percent, TrendingUp, Gem, PieChart, BarChart3, Repeat, Tags, Settings, Search, Users, LogOut } from 'lucide-react'
import { Card, Divider } from '@/components/ui'
import { ListRow, PageHeader } from '@/components/shared'
import { useAuth } from '@/app/providers/AuthProvider'
import { useSignOut } from '@/features/auth/useSignOut'

const groups = [
  {
    title: 'Assets',
    items: [
      { to: '/certificates', label: 'Certificates & deposits', icon: Percent, color: '#eab308' },
      { to: '/investments', label: 'Investments', icon: TrendingUp, color: '#8b5cf6' },
      { to: '/gold', label: 'Gold', icon: Gem, color: '#ca8a04' },
    ],
  },
  {
    title: 'Planning',
    items: [
      { to: '/budgets', label: 'Budgets', icon: PieChart, color: '#14b8a6' },
      { to: '/reports', label: 'Reports', icon: BarChart3, color: '#2563eb' },
      { to: '/recurring', label: 'Recurring', icon: Repeat, color: '#f97316' },
      { to: '/debts?tab=people', label: 'People', icon: Users, color: '#ec4899' },
    ],
  },
  {
    title: 'App',
    items: [
      { to: '/categories', label: 'Categories', icon: Tags, color: '#64748b' },
      { to: '/search', label: 'Search', icon: Search, color: '#0ea5e9' },
      { to: '/settings', label: 'Settings', icon: Settings, color: '#64748b' },
    ],
  },
]

export default function MorePage() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { askSignOut, dialog: signOutDialog } = useSignOut()
  return (
    <div className="anim-fade-up space-y-8">
      <PageHeader title="More" subtitle={<span className="break-all">{session?.user.email}</span>} />
      {groups.map((g) => (
        <section key={g.title}>
          <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">{g.title}</h2>
          <Card className="overflow-hidden">
            {g.items.map((it, i) => (
              <div key={it.to}>
                {i > 0 ? <Divider /> : null}
                <ListRow icon={it.icon} color={it.color} title={it.label} chevron onClick={() => navigate(it.to)} />
              </div>
            ))}
          </Card>
        </section>
      ))}
      <Card className="overflow-hidden">
        <ListRow icon={LogOut} color="#dc2626" title="Sign out" subtitle="On this device" onClick={() => void askSignOut('local')} />
      </Card>
      {signOutDialog}
    </div>
  )
}
