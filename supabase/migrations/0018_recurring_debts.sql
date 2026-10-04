-- 0018: debts that repeat every month
--
-- The owner (4 Oct 2026): a recurring amount you owe someone is added to your balances on a set day
-- every month and you repay it later; or an amount leaves your balances on a set day every month and
-- someone repays you later. Both follow the normal debt logic. So a monthly debt is a rule: on each
-- date it adds an ordinary debt together with its money movement (into the chosen account for money
-- you borrow, out of it for money you lend), exactly like a debt saved with "Money came into / left an
-- account". Repayments, net worth (0017: open debts are not in it) and the rest work as for any debt.
--
-- post_due_recurring_debts adds what is due; the daily jobs (pg_cron, hourly) and the app run it.
-- Dates follow the first date's day of the month (31 Jan, 28 Feb, 31 Mar ...). Each date is added once.
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. the rules, and the link from each debt they add
-- ---------------------------------------------------------------------------
create table if not exists public.recurring_debts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  direction       public.debt_direction not null,
  amount          numeric(20, 4) not null check (amount > 0),
  currency        text not null,
  -- the money comes into (you borrow) or leaves (you lend) this balance on each date
  sub_account_id  uuid not null references public.sub_accounts(id) on delete cascade,
  -- the first date; the next ones fall on the same day of each following month
  start_date      date not null,
  -- the next date not added yet
  next_date       date not null,
  -- the last date that may be added (empty = until stopped)
  end_date        date,
  reason          text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists recurring_debts_user on public.recurring_debts (user_id);
alter table public.recurring_debts enable row level security;
drop policy if exists "owner_all" on public.recurring_debts;
create policy "owner_all" on public.recurring_debts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- with a second sign-in step turned on, a password alone opens nothing (as every table, see 0015)
drop policy if exists "require_second_step" on public.recurring_debts;
create policy "require_second_step" on public.recurring_debts as restrictive for all to authenticated
  using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()));
drop trigger if exists recurring_debts_updated_at on public.recurring_debts;
create trigger recurring_debts_updated_at before update on public.recurring_debts for each row execute function public.set_updated_at();

alter table public.debts add column if not exists recurring_debt_id uuid references public.recurring_debts(id) on delete set null;
create unique index if not exists debts_recurring_uniq on public.debts (recurring_debt_id, date) where recurring_debt_id is not null;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recurring_debts') then
    execute 'alter publication supabase_realtime add table public.recurring_debts';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. a rule must use your own person and a balance in its currency
-- ---------------------------------------------------------------------------
create or replace function public.recurring_debts_validate()
returns trigger language plpgsql as $$
declare s public.sub_accounts%rowtype;
begin
  select * into s from public.sub_accounts where id = new.sub_account_id;
  if not found or s.user_id <> new.user_id then raise exception 'That account does not belong to you'; end if;
  if s.currency <> new.currency then raise exception 'The debt is in % but that account holds %', new.currency, s.currency; end if;
  if not exists (select 1 from public.contacts c where c.id = new.contact_id and c.user_id = new.user_id) then
    raise exception 'Choose who this debt is with';
  end if;
  if new.end_date is not null and new.end_date < new.start_date then raise exception 'The last date is before the first one'; end if;
  if tg_op = 'UPDATE' and new.start_date <> old.start_date then
    raise exception 'The first date can''t change. Stop this monthly debt and add a new one';
  end if;
  if tg_op = 'INSERT' and new.next_date < new.start_date then new.next_date := new.start_date; end if;
  return new;
end $$;
drop trigger if exists recurring_debts_validate on public.recurring_debts;
create trigger recurring_debts_validate before insert or update on public.recurring_debts
  for each row execute function public.recurring_debts_validate();

-- ---------------------------------------------------------------------------
-- 3. add the debts that are due (each date once), with their money movement
-- ---------------------------------------------------------------------------
create or replace function public.post_due_recurring_debts(p_user uuid default auth.uid())
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record; n integer := 0; d date; k integer; today date := public.app_today();
  v_debt uuid; v_tx uuid; v_name text; failed boolean;
begin
  perform public.assert_owner(p_user);
  for r in select * from public.recurring_debts
           where user_id = p_user and is_active and next_date <= today
           for update
  loop
    select name into v_name from public.contacts where id = r.contact_id;
    k := 0;
    failed := false;
    loop
      d := (r.start_date + make_interval(months => k))::date;
      exit when r.end_date is not null and d > r.end_date;
      exit when d > today;
      if d >= r.next_date then
        begin
          v_debt := gen_random_uuid();
          insert into public.debts (id, user_id, contact_id, direction, amount, currency, date, reason, recurring_debt_id)
          values (v_debt, r.user_id, r.contact_id, r.direction, r.amount, r.currency, d, r.reason, r.id)
          on conflict (recurring_debt_id, date) where recurring_debt_id is not null do nothing;
          if found then
            v_tx := gen_random_uuid();
            insert into public.transactions (id, user_id, type, date, amount, currency, sub_account_id, notes, payee, source, source_id)
            values (v_tx, r.user_id, case when r.direction = 'i_owe' then 'income' else 'expense' end::public.transaction_type,
                    d, r.amount, r.currency, r.sub_account_id,
                    case when r.direction = 'i_owe' then 'Borrowed from ' else 'Lent to ' end || coalesce(v_name, ''), v_name, 'debt', v_debt);
            update public.debts set transaction_id = v_tx, sub_account_id = r.sub_account_id where id = v_debt;
            n := n + 1;
          end if;
        exception when others then
          -- e.g. the balance can't take it right now: stop here and try this date again next time
          raise warning 'monthly debt % on % not added: %', r.id, d, sqlerrm;
          failed := true;
        end;
        exit when failed;
      end if;
      k := k + 1;
    end loop;
    update public.recurring_debts
       set next_date = d, is_active = failed or r.end_date is null or d <= r.end_date
     where id = r.id;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 4. the daily jobs add them too (same as 0015 otherwise)
-- ---------------------------------------------------------------------------
create or replace function public.run_daily_jobs()
returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  delete from public.app_errors where created_at < now() - interval '90 days';
  delete from public.reminders where remind_on < current_date - 30;
  for u in select user_id from public.settings loop
    begin
      -- act as that person, so "today" below is their own date
      perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      perform public.post_due_recurring(u);
      perform public.post_due_recurring_debts(u);
      perform public.process_certificate_payouts(u);
      perform public.accrue_yield(u);
      perform public.snapshot_net_worth(u, public.app_today());
    exception when others then
      raise warning 'daily jobs for % failed: %', u, sqlerrm;
    end;
  end loop;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- ---------------------------------------------------------------------------
-- permissions: signed-in users and the scheduler only (see 0011)
-- ---------------------------------------------------------------------------
revoke all on table public.recurring_debts from anon;
grant select, insert, update, delete on table public.recurring_debts to authenticated;
grant all on table public.recurring_debts to service_role;
revoke execute on function public.recurring_debts_validate() from public, anon;
grant execute on function public.recurring_debts_validate() to authenticated, service_role;
revoke execute on function public.post_due_recurring_debts(uuid) from public, anon;
grant execute on function public.post_due_recurring_debts(uuid) to authenticated, service_role;
revoke execute on function public.run_daily_jobs() from public, anon, authenticated;
grant execute on function public.run_daily_jobs() to service_role;

notify pgrst, 'reload schema';
