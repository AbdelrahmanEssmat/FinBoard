import { useNavigate } from 'react-router-dom'
import { Gem, Landmark, Percent, TrendingUp } from 'lucide-react'
import { Card } from '@/components/ui'

const LINKS = [
  { to: '/accounts', label: 'Accounts', icon: Landmark },
  { to: '/certificates', label: 'Certificates', icon: Percent },
  { to: '/investments', label: 'Investments', icon: TrendingUp },
  { to: '/gold', label: 'Gold', icon: Gem },
]

/** First-run guidance shown while there is nothing to summarise. */
export function SetupCard() {
  const navigate = useNavigate()
  return (
    <Card padded>
      <h3 className="font-semibold">Let’s set things up</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">Add your accounts with their current balances, then certificates, investments and gold. Your net worth appears here as you go.</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {LINKS.map((l) => (
          <button key={l.to} onClick={() => navigate(l.to)} className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-4 py-3 text-sm font-medium hover:bg-border">
            <l.icon className="h-4 w-4 text-accent" /> {l.label}
          </button>
        ))}
      </div>
    </Card>
  )
}
