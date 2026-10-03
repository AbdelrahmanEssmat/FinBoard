-- 0016: a debt and the money it moved
--
-- A debt can be saved with or without the money movement that came with it (the money that left an
-- account when lending, or came into one when borrowing). Saved without it, the debt still counts in
-- net worth but no balance changed: net worth jumped by the whole amount, and the repayments (which
-- do move money) later pushed the balance away from the real one. Until now the movement could only
-- be chosen when the debt was first saved. This adds:
--
--   set_debt_account(debt, balance)  link the debt's money to that balance, or move it there
--   set_debt_account(debt, null)     take the money movement off again (the balance goes back)
--
-- and keeps debts.sub_account_id meaning "the balance this debt's money moved in" (empty when nothing
-- moved), also when the money movement is deleted from the activity list.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. link, move or unlink a debt's money movement, in one step
-- ---------------------------------------------------------------------------
create or replace function public.set_debt_account(p_debt_id uuid, p_sub_account_id uuid, p_transaction_id uuid default null)
returns uuid language plpgsql set search_path = public as $$
declare d public.debts%rowtype; s public.sub_accounts%rowtype; v_name text; v_tx uuid;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  -- row-level security: only the person's own debts and balances are visible here
  select * into d from public.debts where id = p_debt_id for update;
  if not found then raise exception 'That debt no longer exists'; end if;

  if p_sub_account_id is null then
    -- take the money movement off: the balance goes back as if the money never moved
    if d.transaction_id is not null then
      delete from public.transactions where id = d.transaction_id;
    end if;
    update public.debts set sub_account_id = null, transaction_id = null
     where id = d.id and (sub_account_id is not null or transaction_id is not null);
    return null;
  end if;

  select * into s from public.sub_accounts where id = p_sub_account_id;
  if not found then raise exception 'That account no longer exists'; end if;
  if s.currency <> d.currency then raise exception 'The debt is in % but that account holds %', d.currency, s.currency; end if;

  if d.transaction_id is not null then
    -- the money already moved: move it to the other balance (the balance trigger shifts the amount)
    update public.transactions set sub_account_id = s.id where id = d.transaction_id and sub_account_id is distinct from s.id;
    update public.debts set sub_account_id = s.id where id = d.id and sub_account_id is distinct from s.id;
    return d.transaction_id;
  end if;

  -- record the money movement, dated with the debt, the way create_debt does
  select name into v_name from public.contacts where id = d.contact_id;
  v_tx := coalesce(p_transaction_id, gen_random_uuid());
  insert into public.transactions (id, user_id, type, date, amount, currency, sub_account_id, notes, payee, source, source_id)
  values (v_tx, d.user_id, case when d.direction = 'i_owe' then 'income' else 'expense' end::public.transaction_type,
          d.date, d.amount, d.currency, s.id,
          case when d.direction = 'i_owe' then 'Borrowed from ' else 'Lent to ' end || coalesce(v_name, ''), v_name, 'debt', d.id);
  -- (no "on conflict": a repeat finds the movement above and returns, so an id that is already taken
  -- is an error, never a silent link to another transaction)
  update public.debts set sub_account_id = s.id, transaction_id = v_tx where id = d.id;
  return v_tx;
end $$;

-- ---------------------------------------------------------------------------
-- 2. deleting a debt's money movement (from the activity list) also clears which balance it used
--    (same as 0006 otherwise)
-- ---------------------------------------------------------------------------
create or replace function public.transactions_cleanup_trigger()
returns trigger language plpgsql as $$
begin
  if old.source::text = 'debt' then
    perform set_config('app.deleting_tx', old.id::text, true);
    delete from public.debt_payments where transaction_id = old.id;
    update public.debts set transaction_id = null, sub_account_id = null where transaction_id = old.id;
    perform set_config('app.deleting_tx', '', true);
  elsif old.source::text = 'investment' then
    perform set_config('app.deleting_tx', old.id::text, true);
    delete from public.holding_sales where transaction_id = old.id;
    perform set_config('app.deleting_tx', '', true);
  elsif old.source::text = 'certificate' then
    update public.certificate_payouts set status = 'skipped', transaction_id = null where transaction_id = old.id;
  end if;
  return old;
end $$;

-- ---------------------------------------------------------------------------
-- 3. existing debts: the balance named is the one the money really moved in, or none
-- ---------------------------------------------------------------------------
update public.debts x set sub_account_id = t.sub_account_id
  from public.transactions t
 where t.id = x.transaction_id and x.sub_account_id is distinct from t.sub_account_id;
update public.debts set sub_account_id = null where transaction_id is null and sub_account_id is not null;

-- ---------------------------------------------------------------------------
-- permissions: signed-in users and the scheduler only (see 0011)
-- ---------------------------------------------------------------------------
revoke execute on function public.set_debt_account(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_debt_account(uuid, uuid, uuid) to authenticated, service_role;
revoke execute on function public.transactions_cleanup_trigger() from public, anon;
grant execute on function public.transactions_cleanup_trigger() to authenticated, service_role;

notify pgrst, 'reload schema';
