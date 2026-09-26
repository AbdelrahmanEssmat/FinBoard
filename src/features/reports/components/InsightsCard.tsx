import { Lightbulb, TrendingDown, TrendingUp, AlertTriangle } from 'lucide-react'
import { Card } from '@/components/ui'
import { Section } from '@/components/shared'
import { usePrefs } from '@/store/prefs'
import { cn } from '@/utils'
import type { Insight } from '@/domain/insights'

const TONE = {
  good: { icon: TrendingUp, cls: 'bg-positive-soft text-positive' },
  warn: { icon: AlertTriangle, cls: 'bg-warning-soft text-warning' },
  info: { icon: Lightbulb, cls: 'bg-accent-soft text-accent' },
}

export function InsightsCard({ insights }: { insights: Insight[] }) {
  const privacy = usePrefs((s) => s.privacy)
  return (
    <Section title="Insights">
      <Card className="divide-y divide-border">
        {insights.map((i) => {
          const t = TONE[i.tone]
          const Icon = i.tone === 'good' && /fell|lower|less/.test(i.title) ? TrendingDown : t.icon
          return (
            <div key={i.id} className="flex gap-4 px-5 py-4">
              <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full', t.cls)}>
                <Icon className="h-4 w-4" />
              </span>
              <div className={cn('min-w-0', privacy && 'privacy-blur')}>
                <div className="text-[15px] font-medium leading-snug">{i.title}</div>
                {i.detail ? <div className="mt-0.5 text-[13px] leading-relaxed text-muted">{i.detail}</div> : null}
              </div>
            </div>
          )
        })}
        {!insights.length ? <p className="p-5 text-sm text-muted">Add a few weeks of transactions and insights will appear here.</p> : null}
      </Card>
    </Section>
  )
}
