/* Hand-maintained to match supabase/migrations/0001_init.sql */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type AccountType = 'bank' | 'cash' | 'investment' | 'wallet' | 'credit_card' | 'other'
export type TransactionType = 'income' | 'expense' | 'transfer'
export type TransactionSource = 'manual' | 'recurring' | 'certificate' | 'debt' | 'yield' | 'investment' | 'detached_transfer' | 'adjustment'
export type CategoryKind = 'income' | 'expense'
export type PayoutFrequency = 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'at_maturity'
export type PayoutStatus = 'pending' | 'logged' | 'skipped'
export type GoldType = 'bar' | 'coin' | 'jewelry'
export type DebtDirection = 'i_owe' | 'owed_to_me'
export type DebtStatus = 'open' | 'settled'
export type RateSource = 'api' | 'manual'
export type GoldPriceSource = 'local' | 'global' | 'manual'
export type Recurrence = 'daily' | 'weekly' | 'monthly' | 'yearly'

export type Currency = {
  user_id: string
  code: string
  name: string
  symbol: string
  decimals: number
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type Settings = {
  user_id: string
  base_currency: string
  defaults: Json
  /** IANA time zone; the app keeps it in step with the device so dates follow where you are */
  timezone: string
  created_at: string
  updated_at: string
}

export type ExchangeRate = {
  id: string
  user_id: string | null
  quote: string
  rate: number
  rate_date: string
  source: RateSource
  fetched_at: string
  provider: string | null
  created_at: string
}

export type Account = {
  id: string
  user_id: string
  name: string
  type: AccountType
  color: string
  icon: string
  notes: string | null
  is_archived: boolean
  sort_order: number
  /** credit cards: limit in the card's main currency */
  credit_limit: number | null
  /** credit cards: day of the month the statement is issued (1–31) */
  statement_day: number | null
  /** credit cards: day of the month the payment is due (1–31) */
  due_day: number | null
  /** credit cards: minimum payment as % of the statement balance */
  min_payment_pct: number | null
  /** credit cards: the bank account that issued the card */
  bank_account_id: string | null
  created_at: string
  updated_at: string
}

export type SubAccount = {
  id: string
  user_id: string
  account_id: string
  currency: string
  name: string | null
  opening_balance: number
  balance: number
  is_archived: boolean
  sort_order: number
  /** Clouds: annual rate (%) and payout frequency; null for ordinary balances */
  yield_rate: number | null
  yield_frequency: Recurrence | null
  yield_since: string | null
  /** last day interest was accrued up to (server-managed) */
  yield_accrued_through: string | null
  created_at: string
  updated_at: string
}

export type Category = {
  id: string
  user_id: string
  parent_id: string | null
  kind: CategoryKind
  name: string
  icon: string
  color: string
  is_archived: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type Tag = {
  id: string
  user_id: string
  name: string
  color: string
  created_at: string
}

export type Transaction = {
  id: string
  user_id: string
  type: TransactionType
  date: string
  amount: number
  currency: string
  sub_account_id: string
  category_id: string | null
  tags: string[]
  notes: string | null
  payee: string | null
  to_sub_account_id: string | null
  to_amount: number | null
  to_currency: string | null
  rate_used: number | null
  source: TransactionSource
  source_id: string | null
  created_at: string
  updated_at: string
}

export type RecurringTransaction = {
  id: string
  user_id: string
  name: string
  type: TransactionType
  amount: number
  currency: string
  sub_account_id: string
  category_id: string | null
  tags: string[]
  notes: string | null
  to_sub_account_id: string | null
  to_amount: number | null
  to_currency: string | null
  frequency: Recurrence
  interval_count: number
  next_date: string
  /** occurrences are anchor_date + k × interval (server-managed) */
  anchor_date: string | null
  end_date: string | null
  auto_post: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export type Budget = {
  id: string
  user_id: string
  category_id: string
  amount: number
  currency: string
  created_at: string
  updated_at: string
}

export type Certificate = {
  id: string
  user_id: string
  account_id: string
  name: string
  principal: number
  currency: string
  interest_rate: number
  payout_frequency: PayoutFrequency
  start_date: string
  maturity_date: string
  auto_log_income: boolean
  payout_sub_account_id: string | null
  notes: string | null
  is_closed: boolean
  created_at: string
  updated_at: string
}

export type CertificatePayout = {
  id: string
  user_id: string
  certificate_id: string
  due_date: string
  amount: number
  status: PayoutStatus
  transaction_id: string | null
  /** the day after the previous payout date: the payout covers period_start (exclusive) to due_date */
  period_start: string | null
  created_at: string
  updated_at: string
}

export type InvestmentCategory = {
  id: string
  user_id: string
  name: string
  sort_order: number
  created_at: string
}

export type Holding = {
  id: string
  user_id: string
  account_id: string
  category_id: string | null
  name: string
  ticker: string | null
  units: number
  avg_cost: number
  current_price: number
  currency: string
  price_updated_at: string | null
  /** first purchase date, for the holding period */
  bought_at: string | null
  /** set when every unit has been sold */
  closed_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** A credit card purchase paid over several statements (see migration 0009). */
export type CardInstallmentPlan = {
  id: string
  user_id: string
  account_id: string
  sub_account_id: string
  /** the purchase expense (full price) */
  transaction_id: string | null
  /** interest / admin fees expense, if any */
  fees_transaction_id: string | null
  description: string
  currency: string
  principal: number
  fees: number
  months: number
  purchase_date: string
  /** statement date of the first installment */
  first_billing_date: string
  /** settled early: whatever is left is billed on the next statement */
  closed_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type HoldingSale = {
  id: string
  user_id: string
  holding_id: string
  date: string
  units: number
  /** per unit */
  sell_price: number
  fees: number
  /** buy price per unit at the time of the sale */
  avg_cost: number
  cost_basis: number
  proceeds: number
  realized: number
  currency: string
  bought_at: string | null
  sub_account_id: string | null
  transaction_id: string | null
  notes: string | null
  /** the price the sale replaced, so undoing it can put it back */
  prev_price: number | null
  prev_price_at: string | null
  set_price_at: string | null
  created_at: string
}

export type GoldItem = {
  id: string
  user_id: string
  name: string | null
  karat: number
  weight_grams: number
  type: GoldType
  purchase_price: number
  purchase_currency: string
  workmanship_cost: number
  purchase_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type GoldPrice = {
  id: string
  user_id: string | null
  karat: number
  price_per_gram: number
  currency: string
  source: GoldPriceSource
  source_name: string | null
  price_at: string
  created_at: string
}

export type Contact = {
  id: string
  user_id: string
  name: string
  phone: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type Debt = {
  id: string
  user_id: string
  contact_id: string
  direction: DebtDirection
  amount: number
  currency: string
  date: string
  due_date: string | null
  reason: string | null
  notes: string | null
  plan_count: number | null
  plan_amount: number | null
  plan_frequency: Recurrence | null
  plan_start_date: string | null
  status: DebtStatus
  sub_account_id: string | null
  transaction_id: string | null
  /** set when a monthly debt (recurring_debts) added it */
  recurring_debt_id: string | null
  created_at: string
  updated_at: string
}

/** A debt that repeats every month: on each date an ordinary debt is added, with its money moving in or out of sub_account_id. */
export type RecurringDebt = {
  id: string
  user_id: string
  contact_id: string
  direction: DebtDirection
  amount: number
  currency: string
  sub_account_id: string
  /** the first date; the next ones fall on the same day of each month */
  start_date: string
  /** the next date not added yet */
  next_date: string
  end_date: string | null
  reason: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type DebtPayment = {
  id: string
  user_id: string
  debt_id: string
  amount: number
  date: string
  sub_account_id: string | null
  transaction_id: string | null
  notes: string | null
  created_at: string
}

export type NetWorthSnapshot = {
  id: string
  user_id: string
  snapshot_date: string
  base_currency: string
  total: number
  by_class: Json
  by_currency: Json
  created_at: string
}

export type YieldRate = {
  id: string
  user_id: string
  sub_account_id: string
  effective_from: string
  rate: number
  created_at: string
}

export type PushSubscriptionRow = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  created_at: string
  last_success_at: string | null
}

export type Reminder = {
  id: string
  user_id: string
  key: string
  remind_on: string
  title: string
  body: string
  url: string
  sent_at: string | null
  created_at: string
}

export type AppError = {
  id: string
  user_id: string
  created_at: string
  kind: string
  message: string
  stack: string | null
  url: string | null
  app_version: string | null
  user_agent: string | null
}

/** Numeric columns may be sent as strings (exact decimals). */
type Writable<T> = {
  [K in keyof T]: T[K] extends number ? number | string : T[K] extends number | null ? number | string | null : T[K]
}
type TableDef<Row> = { Row: Row; Insert: Partial<Writable<Row>>; Update: Partial<Writable<Row>>; Relationships: [] }

export type Database = {
  public: {
    Tables: {
      currencies: TableDef<Currency>
      settings: TableDef<Settings>
      exchange_rates: TableDef<ExchangeRate>
      accounts: TableDef<Account>
      sub_accounts: TableDef<SubAccount>
      categories: TableDef<Category>
      tags: TableDef<Tag>
      transactions: TableDef<Transaction>
      recurring_transactions: TableDef<RecurringTransaction>
      budgets: TableDef<Budget>
      certificates: TableDef<Certificate>
      certificate_payouts: TableDef<CertificatePayout>
      investment_categories: TableDef<InvestmentCategory>
      holdings: TableDef<Holding>
      holding_sales: TableDef<HoldingSale>
      card_installment_plans: TableDef<CardInstallmentPlan>
      gold_items: TableDef<GoldItem>
      gold_prices: TableDef<GoldPrice>
      contacts: TableDef<Contact>
      debts: TableDef<Debt>
      recurring_debts: TableDef<RecurringDebt>
      debt_payments: TableDef<DebtPayment>
      net_worth_snapshots: TableDef<NetWorthSnapshot>
      yield_rates: TableDef<YieldRate>
      push_subscriptions: TableDef<PushSubscriptionRow>
      reminders: TableDef<Reminder>
      app_errors: TableDef<AppError>
    }
    Views: { [_ in never]: never }
    Functions: {
      snapshot_net_worth: { Args: { p_user?: string; p_date?: string }; Returns: Json }
      compute_net_worth: { Args: { p_user: string; p_base: string; p_date?: string }; Returns: Json }
      post_due_recurring: { Args: { p_user?: string }; Returns: number }
      post_due_recurring_debts: { Args: { p_user?: string }; Returns: number }
      accrue_yield: { Args: { p_user?: string }; Returns: number }
      sell_holding: {
        Args: {
          p_holding_id: string
          p_units: number | string
          p_price: number | string
          p_date: string
          p_fees?: number | string
          p_sub_account_id?: string | null
          p_notes?: string | null
          p_sale_id?: string
          p_transaction_id?: string
        }
        Returns: string
      }
      process_certificate_payouts: { Args: { p_user?: string }; Returns: number }
      log_certificate_payout: { Args: { p_payout_id: string; p_sub_account_id?: string | null; p_transaction_id?: string }; Returns: string }
      record_debt_payment: {
        Args: {
          p_debt_id: string
          p_amount: number | string
          p_date: string
          p_sub_account_id?: string | null
          p_notes?: string | null
          p_payment_id?: string
          p_transaction_id?: string
        }
        Returns: string
      }
      generate_certificate_payouts: { Args: { p_certificate_id: string }; Returns: undefined }
      recompute_sub_account_balance: { Args: { p_sub_account_id: string }; Returns: undefined }
      set_sub_account_balance: { Args: { p_sub_account_id: string; p_balance: string }; Returns: number }
      convert_amount: { Args: { p_user: string; p_amount: number | string; p_from: string; p_to: string; p_date: string }; Returns: number }
      create_debt: {
        Args: {
          p_id: string
          p_contact_id: string
          p_new_contact_name: string | null
          p_direction: DebtDirection
          p_amount: string
          p_currency: string
          p_date: string
          p_due_date: string | null
          p_reason: string | null
          p_notes: string | null
          p_plan_count: number | null
          p_plan_amount: string | null
          p_plan_frequency: Recurrence | null
          p_plan_start_date: string | null
          p_sub_account_id: string | null
          p_transaction_id: string | null
        }
        Returns: string
      }
      create_installment_purchase: {
        Args: {
          p_plan_id: string
          p_purchase_tx_id: string
          p_fee_tx_id: string | null
          p_sub_account_id: string
          p_description: string
          p_category_id: string | null
          p_fee_category_id: string | null
          p_principal: string
          p_fees: string
          p_months: number
          p_purchase_date: string
          p_first_billing_date: string
          p_purchase_notes: string | null
        }
        Returns: string
      }
      save_push_subscription: { Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent?: string | null }; Returns: undefined }
      replace_reminders: { Args: { p_items: Json }; Returns: number }
      delete_my_account: { Args: Record<string, never>; Returns: undefined }
      mfa_satisfied: { Args: Record<string, never>; Returns: boolean }
      set_debt_account: { Args: { p_debt_id: string; p_sub_account_id: string | null; p_transaction_id?: string | null }; Returns: string | null }
    }
    Enums: {
      account_type: AccountType
      transaction_type: TransactionType
      transaction_source: TransactionSource
      category_kind: CategoryKind
      payout_frequency: PayoutFrequency
      payout_status: PayoutStatus
      gold_type: GoldType
      debt_direction: DebtDirection
      debt_status: DebtStatus
      rate_source: RateSource
      gold_price_source: GoldPriceSource
      recurrence: Recurrence
    }
    CompositeTypes: { [_ in never]: never }
  }
}

export type TableName = keyof Database['public']['Tables']
export type Row<T extends TableName> = Database['public']['Tables'][T]['Row']
export type Insert<T extends TableName> = Database['public']['Tables'][T]['Insert']
