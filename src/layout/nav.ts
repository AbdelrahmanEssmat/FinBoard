import { LayoutDashboard, Landmark, ArrowLeftRight, HandCoins, Ellipsis, Percent, TrendingUp, Gem, PieChart, BarChart3, Settings, Repeat, Tags, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

/** Bottom tab bar on phones. */
export const TABS: NavItem[] = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/accounts', label: 'Accounts', icon: Landmark },
  { to: '/transactions', label: 'Activity', icon: ArrowLeftRight },
  { to: '/debts', label: 'Debts', icon: HandCoins },
  { to: '/more', label: 'More', icon: Ellipsis },
]

/** Extra destinations shown in the desktop sidebar (the phone reaches them through "More"). */
export const SIDEBAR_EXTRA: NavItem[] = [
  { to: '/certificates', label: 'Certificates', icon: Percent },
  { to: '/investments', label: 'Investments', icon: TrendingUp },
  { to: '/gold', label: 'Gold', icon: Gem },
  { to: '/budgets', label: 'Budgets', icon: PieChart },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/recurring', label: 'Recurring', icon: Repeat },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/settings', label: 'Settings', icon: Settings },
]
