-- =============================================================================
-- 0012: row locks and trigger precision. Safe to run as one transaction and to re-run.
--
--  1. A certificate payout could be logged twice as income when two things logged it at once
--     (the app open on two phones, or the app and the nightly job): the payout row is now locked
--     while it is logged, and the database refuses a second income for the same payout.
--  2. Two debt repayments recorded at the same moment could together exceed what was left: the
--     debt row is locked while a repayment is checked and saved.
--  3. Saving a certificate with nothing but its notes changed regenerated its pending payouts under
--     new ids (an "update of principal, …" trigger fires whenever those columns are in the SET
--     list, even unchanged). The schedule is now only rebuilt when one of those values changes.
--  4. Deleting the fee expense of an installment plan cleared the link but the plan kept billing
--     the fee. The fee is now zeroed with it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. one income transaction per certificate payout
-- ---------------------------------------------------------------------------
-- remove any duplicates the old race produced (keep the one the payout points at, else the oldest)
delete from public.transactions t
using (
  select x.id,
         row_number() over (
           partition by x.source_id
           order by (exists (select 1 from public.certificate_payouts cp where cp.transaction_id = x.id)) desc, x.created_at, x.id
         ) as rn
  from public.transactions x
  where x.source = 'certificate' and x.source_id is not null
) d
where t.id = d.id and d.rn > 1;

create unique index if not exists transactions_certificate_uniq on public.transactions (source_id) where source = 'certificate';

create or replace function public.log_certificate_payout(p_payout_id uuid, p_sub_account_id uuid default null, p_transaction_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p public.certificate_payouts%rowtype; c public.certificates%rowtype; s public.sub_accounts%rowtype; cat uuid;
begin
  -- locked until this call ends: a second caller waits, then sees the payout already logged
  select * into p from public.certificate_payouts where id = p_payout_id for update;
  if not found then raise exception 'payout not found'; end if;
  perform public.assert_owner(p.user_id);
  if p.status = 'logged' then return p.transaction_id; end if;
  select * into c from public.certificates where id = p.certificate_id;
  select * into s from public.sub_accounts where id = coalesce(p_sub_account_id, c.payout_sub_account_id);
  if not found then raise exception 'Choose an account to receive the payout'; end if;
  if s.user_id <> p.user_id then raise exception 'That account does not belong to you'; end if;
  if s.currency <> c.currency then raise exception 'The payout is in % but that account holds %', c.currency, s.currency; end if;
  select id into cat from public.categories where user_id = p.user_id and kind = 'income' and lower(name) = 'interest' limit 1;
  insert into public.transactions (id, user_id, type, date, amount, currency, sub_account_id, category_id, notes, source, source_id)
  values (p_transaction_id, p.user_id, 'income', p.due_date, p.amount, c.currency, s.id, cat, c.name || ' payout', 'certificate', p.id)
  on conflict (id) do nothing;
  update public.certificate_payouts set status = 'logged', transaction_id = p_transaction_id where id = p.id;
  return p_transaction_id;
end $$;

create or replace function public.process_certificate_payouts(p_user uuid default auth.uid())
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  perform public.assert_owner(p_user);
  -- always in the same order, so two callers never wait on each other's locks
  for r in select p.id from public.certificate_payouts p join public.certificates c on c.id = p.certificate_id
           where p.user_id = p_user and p.status = 'pending' and p.due_date <= public.app_today()
             and c.auto_log_income and c.payout_sub_account_id is not null and not c.is_closed
           order by p.due_date, p.id
  loop
    begin
      perform public.log_certificate_payout(r.id);
      n := n + 1;
    exception when others then
      raise warning 'payout % not logged: %', r.id, sqlerrm;  -- e.g. payout account in another currency
    end;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 2. repayments are checked and saved under a lock on the debt
-- ---------------------------------------------------------------------------
create or replace function public.record_debt_payment(
  p_debt_id uuid, p_amount numeric, p_date date, p_sub_account_id uuid default null, p_notes text default null,
  p_payment_id uuid default gen_random_uuid(), p_transaction_id uuid default gen_random_uuid()
) returns uuid language plpgsql security definer set search_path = public as $$
declare d public.debts%rowtype; s public.sub_accounts%rowtype; c public.contacts%rowtype; tx uuid := null; v_paid numeric;
begin
  select * into d from public.debts where id = p_debt_id for update;
  if not found then raise exception 'debt not found'; end if;
  perform public.assert_owner(d.user_id);
  if exists (select 1 from public.debt_payments where id = p_payment_id) then return p_payment_id; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero'; end if;
  select coalesce(sum(amount), 0) into v_paid from public.debt_payments where debt_id = d.id;
  if p_amount > d.amount - v_paid then
    raise exception 'That is more than the % % left on this debt', round(d.amount - v_paid, 2), d.currency;
  end if;
  select * into c from public.contacts where id = d.contact_id;
  if p_sub_account_id is not null then
    select * into s from public.sub_accounts where id = p_sub_account_id;
    if not found or s.user_id <> d.user_id then raise exception 'That account does not belong to you'; end if;
    if s.currency <> d.currency then raise exception 'The debt is in % but that account holds %', d.currency, s.currency; end if;
    insert into public.transactions (id, user_id, type, date, amount, currency, sub_account_id, notes, payee, source, source_id)
    values (p_transaction_id, d.user_id, case when d.direction = 'owed_to_me' then 'income' else 'expense' end::public.transaction_type,
            p_date, p_amount, d.currency, s.id,
            case when d.direction = 'owed_to_me' then 'Repayment from ' else 'Repayment to ' end || c.name, c.name, 'debt', d.id)
    on conflict (id) do nothing;
    tx := p_transaction_id;
  end if;
  insert into public.debt_payments (id, user_id, debt_id, amount, date, sub_account_id, transaction_id, notes)
  values (p_payment_id, d.user_id, p_debt_id, p_amount, p_date, p_sub_account_id, tx, p_notes);
  return p_payment_id;
end $$;

-- ---------------------------------------------------------------------------
-- 3. the payout schedule is rebuilt only when something that shapes it changes
-- ---------------------------------------------------------------------------
drop trigger if exists certificates_schedule on public.certificates;
drop trigger if exists certificates_schedule_insert on public.certificates;
drop trigger if exists certificates_schedule_update on public.certificates;
create trigger certificates_schedule_insert after insert on public.certificates
  for each row execute function public.certificates_schedule_trigger();
create trigger certificates_schedule_update after update of principal, interest_rate, payout_frequency, start_date, maturity_date on public.certificates
  for each row
  when (old.principal is distinct from new.principal or old.interest_rate is distinct from new.interest_rate
        or old.payout_frequency is distinct from new.payout_frequency or old.start_date is distinct from new.start_date
        or old.maturity_date is distinct from new.maturity_date)
  execute function public.certificates_schedule_trigger();

-- ---------------------------------------------------------------------------
-- 4. a deleted fee expense takes the plan's fee with it
-- ---------------------------------------------------------------------------
create or replace function public.card_installment_plans_fees_cleared()
returns trigger language plpgsql as $$
begin
  -- the fee expense was deleted (the foreign key set the link to null): nothing is owed for it any more
  if new.fees_transaction_id is null and old.fees_transaction_id is not null then new.fees := 0; end if;
  return new;
end $$;
drop trigger if exists card_installment_plans_fees_cleared on public.card_installment_plans;
create trigger card_installment_plans_fees_cleared before update of fees_transaction_id on public.card_installment_plans
  for each row execute function public.card_installment_plans_fees_cleared();

-- ---------------------------------------------------------------------------
-- permissions: signed-in users and the scheduler only (see 0011)
-- ---------------------------------------------------------------------------
revoke execute on function public.log_certificate_payout(uuid, uuid, uuid) from public, anon;
grant execute on function public.log_certificate_payout(uuid, uuid, uuid) to authenticated, service_role;
revoke execute on function public.process_certificate_payouts(uuid) from public, anon;
grant execute on function public.process_certificate_payouts(uuid) to authenticated, service_role;
revoke execute on function public.record_debt_payment(uuid, numeric, date, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.record_debt_payment(uuid, numeric, date, uuid, text, uuid, uuid) to authenticated, service_role;
revoke execute on function public.card_installment_plans_fees_cleared() from public, anon;
grant execute on function public.card_installment_plans_fees_cleared() to authenticated, service_role;
revoke execute on function public.certificates_schedule_trigger() from public, anon;
grant execute on function public.certificates_schedule_trigger() to authenticated, service_role;
