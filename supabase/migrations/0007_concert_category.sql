-- 0007: "Concert" income category.
--  * Every existing user gets a Concert income category (music icon) unless they already have one
--    with that name. Safe to re-run: it never creates a second one.
--  * New users get it in their starter categories (handle_new_user is redefined with it included;
--    everything else in the function is unchanged from 0001).
-- Run in the Supabase SQL Editor as one transaction.

insert into public.categories (user_id, kind, name, icon, color, sort_order)
select u.id, 'income', 'Concert', 'music', '#f97316', 1
from auth.users u
where not exists (
  select 1 from public.categories c
  where c.user_id = u.id and c.kind = 'income' and lower(c.name) = 'concert'
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cash_id uuid; thndr_id uuid; c uuid;
begin
  insert into public.settings (user_id) values (new.id) on conflict do nothing;

  insert into public.currencies (user_id, code, name, symbol, decimals, is_active, sort_order) values
    (new.id, 'EGP', 'Egyptian Pound', 'E£', 2, true, 0),
    (new.id, 'USD', 'US Dollar', '$', 2, true, 1),
    (new.id, 'EUR', 'Euro', '€', 2, false, 2),
    (new.id, 'SAR', 'Saudi Riyal', 'SR', 2, false, 3),
    (new.id, 'AED', 'UAE Dirham', 'AED', 2, false, 4),
    (new.id, 'GBP', 'British Pound', '£', 2, false, 5)
  on conflict do nothing;

  -- expense categories
  insert into public.categories (user_id, kind, name, icon, color, sort_order) values
    (new.id, 'expense', 'Food & Groceries', 'shopping-basket', '#22c55e', 0),
    (new.id, 'expense', 'Restaurants & Cafés', 'coffee', '#f97316', 1),
    (new.id, 'expense', 'Transport & Fuel', 'car', '#3b82f6', 2),
    (new.id, 'expense', 'Housing & Rent', 'home', '#8b5cf6', 3),
    (new.id, 'expense', 'Utilities', 'zap', '#eab308', 4),
    (new.id, 'expense', 'Mobile & Internet', 'smartphone', '#06b6d4', 5),
    (new.id, 'expense', 'Health', 'heart-pulse', '#ef4444', 6),
    (new.id, 'expense', 'Shopping', 'shopping-bag', '#ec4899', 7),
    (new.id, 'expense', 'Entertainment', 'clapperboard', '#a855f7', 8),
    (new.id, 'expense', 'Subscriptions', 'repeat', '#14b8a6', 9),
    (new.id, 'expense', 'Education', 'graduation-cap', '#0ea5e9', 10),
    (new.id, 'expense', 'Family & Gifts', 'gift', '#f43f5e', 11),
    (new.id, 'expense', 'Travel', 'plane', '#6366f1', 12),
    (new.id, 'expense', 'Fees & Charges', 'receipt', '#64748b', 13),
    (new.id, 'expense', 'Other', 'circle-ellipsis', '#94a3b8', 14);
  -- income categories
  insert into public.categories (user_id, kind, name, icon, color, sort_order) values
    (new.id, 'income', 'Salary', 'briefcase', '#22c55e', 0),
    (new.id, 'income', 'Concert', 'music', '#f97316', 1),
    (new.id, 'income', 'Freelance', 'laptop', '#3b82f6', 2),
    (new.id, 'income', 'Interest', 'percent', '#eab308', 3),
    (new.id, 'income', 'Investment Returns', 'trending-up', '#8b5cf6', 4),
    (new.id, 'income', 'Gifts', 'gift', '#ec4899', 5),
    (new.id, 'income', 'Other', 'circle-ellipsis', '#94a3b8', 6);

  insert into public.investment_categories (user_id, name, sort_order) values
    (new.id, 'Stocks', 0), (new.id, 'Mutual funds', 1), (new.id, 'Gold funds', 2), (new.id, 'Other', 3);

  insert into public.accounts (user_id, name, type, color, icon, sort_order)
  values (new.id, 'Cash', 'cash', '#22c55e', 'wallet', 0) returning id into cash_id;
  insert into public.sub_accounts (user_id, account_id, currency) values (new.id, cash_id, 'EGP'), (new.id, cash_id, 'USD');

  insert into public.accounts (user_id, name, type, color, icon, sort_order)
  values (new.id, 'Thndr', 'investment', '#8b5cf6', 'trending-up', 1) returning id into thndr_id;
  insert into public.sub_accounts (user_id, account_id, currency, name) values (new.id, thndr_id, 'EGP', 'Cash balance');

  return new;
end $$;
