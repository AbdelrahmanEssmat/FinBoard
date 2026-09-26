import { useNavigate } from 'react-router-dom'
import { Card, Divider } from '@/components/ui'
import { Amount, ListRow, Section } from '@/components/shared'
import { formatDate } from '@/domain/format'
import { useUpcoming } from '@/features/dashboard/useUpcoming'

export function UpcomingList() {
  const navigate = useNavigate()
  const upcoming = useUpcoming()
  return (
    <Section title="Upcoming">
      <Card className="overflow-hidden">
        {upcoming.map((u, i) => (
          <div key={u.key}>
            {i > 0 ? <Divider /> : null}
            <ListRow
              icon={u.icon}
              color={u.color}
              title={u.title}
              subtitle={`${u.overdue ? 'Overdue · ' : ''}${formatDate(u.date)} · ${u.subtitle}`}
              trailing={u.amount ? <Amount value={u.amount} currency={u.currency} className={`font-medium ${u.overdue ? 'text-negative' : ''}`} /> : null}
              onClick={() => navigate(u.to)}
              chevron
            />
          </div>
        ))}
        {!upcoming.length ? <p className="p-5 text-sm text-muted">Nothing due in the next 30 days.</p> : null}
      </Card>
    </Section>
  )
}
