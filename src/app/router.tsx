import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { AppShell } from '@/layout/AppShell'
import { AuthGate } from '@/app/AuthGate'
import { Skeleton } from '@/components/ui'

const load = (factory: () => Promise<{ default: React.ComponentType }>) => {
  const C = lazy(factory)
  return (
    <Suspense
      fallback={
        <div className="space-y-3 p-1">
          <Skeleton className="h-28" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      }
    >
      <C />
    </Suspense>
  )
}

export const router = createBrowserRouter([
  { path: '/login', element: load(() => import('@/features/auth/LoginPage')) },
  {
    path: '/',
    element: (
      <AuthGate>
        <AppShell>
          <Outlet />
        </AppShell>
      </AuthGate>
    ),
    children: [
      { index: true, element: load(() => import('@/features/dashboard/DashboardPage')) },
      { path: 'accounts', element: load(() => import('@/features/accounts/AccountsPage')) },
      { path: 'accounts/:id', element: load(() => import('@/features/accounts/AccountDetailPage')) },
      { path: 'transactions', element: load(() => import('@/features/transactions/TransactionsPage')) },
      { path: 'recurring', element: load(() => import('@/features/transactions/RecurringPage')) },
      { path: 'debts', element: load(() => import('@/features/debts/DebtsPage')) },
      { path: 'debts/:id', element: load(() => import('@/features/debts/DebtDetailPage')) },
      { path: 'more', element: load(() => import('@/features/more/MorePage')) },
      { path: 'certificates', element: load(() => import('@/features/certificates/CertificatesPage')) },
      { path: 'certificates/:id', element: load(() => import('@/features/certificates/CertificateDetailPage')) },
      { path: 'investments', element: load(() => import('@/features/investments/InvestmentsPage')) },
      { path: 'investments/prices', element: load(() => import('@/features/investments/UpdatePricesPage')) },
      { path: 'gold', element: load(() => import('@/features/gold/GoldPage')) },
      { path: 'budgets', element: load(() => import('@/features/budgets/BudgetsPage')) },
      { path: 'reports', element: load(() => import('@/features/reports/ReportsPage')) },
      { path: 'categories', element: load(() => import('@/features/categories/CategoriesPage')) },
      { path: 'categories/:id', element: load(() => import('@/features/categories/CategoryDetailPage')) },
      { path: 'settings', element: load(() => import('@/features/settings/SettingsPage')) },
      { path: 'settings/currencies', element: load(() => import('@/features/settings/CurrenciesPage')) },
      { path: 'settings/rates', element: load(() => import('@/features/settings/RatesPage')) },
      { path: 'search', element: load(() => import('@/features/search/SearchPage')) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
