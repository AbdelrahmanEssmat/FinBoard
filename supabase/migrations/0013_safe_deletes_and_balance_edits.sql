-- 0013: deleting a balance or an account always works and never changes anything else;
-- editing a balance sets the current balance exactly.
--
-- Before: a balance (or a whole account) that ever had a transfer with another balance, a debt
-- repayment or an investment sale could not be deleted at all ("Archive it instead"). And where a
-- delete did go through, the cascade quietly rewrote other records: a repaid debt became open
-- again, a sold investment got its units back, logged certificate interest became "skipped".
--
-- Now, when a balance goes (on its own or with its account):
--   * its own income and expenses go with it;
--   * a transfer with a balance that stays becomes a one-sided entry on that balance (income if
--     money came from the deleted balance, expense if it went there), with the same amount and
--     date, so the remaining balance and its history do not move. These entries are marked
--     source = 'detached_transfer' and, like loans, are not counted as income or spending;
--   * debt repayments, investment sales and certificate payouts stay recorded; they only lose
--     the link to the money movement that no longer exists.
-- Transfers between two balances that are both being deleted simply disappear.
--
-- Safe to re-run.

alter type public.transaction_source add value if not exists 'detached_transfer';

-- ---------------------------------------------------------------------------
-- 1. balance trigger: skip the balance that is being deleted
--    (its BEFORE DELETE trigger rewrites transfers; touching the row being deleted is an error)
-- ---------------------------------------------------------------------------
create or replace function public.apply_transaction_delta(t public.transactions, sign integer)
returns void language plpgsql as $$
declare skip text := coalesce(current_setting('app.deleting_sub', true), '');
begin
  if t.type = 'income' then
    update public.sub_accounts set balance = balance + sign * t.amount where id = t.sub_account_id and id::text <> skip;
  elsif t.type = 'expense' then
    update public.sub_accounts set balance = balance - sign * t.amount where id = t.sub_account_id and id::text <> skip;
  elsif t.type = 'transfer' then
    update public.sub_accounts set balance = balance - sign * t.amount    where id = t.sub_account_id and id::text <> skip;
    update public.sub_accounts set balance = balance + sign * t.to_amount where id = t.to_sub_account_id and id::text <> skip;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. what happens to everything linked to a balance that is about to be deleted
--    p_account: set when the whole account is being deleted (its other balances go too)
-- ---------------------------------------------------------------------------
create or replace function public.detach_sub_account(p_sub uuid, p_account uuid default null)
returns void language plpgsql set search_path = public as $$
declare
  v_user uuid;
  v_label text;
begin
  select s.user_id, a.name || coalesce(' · ' || nullif(btrim(s.name), ''), '') || ' (' || s.currency || ')'
    into v_user, v_label
  from public.sub_accounts s join public.accounts a on a.id = s.account_id
  where s.id = p_sub;
  if v_user is null then return; end if;

  -- money that came FROM the deleted balance: income on the balance that received it
  update public.transactions t
     set type = 'income', sub_account_id = t.to_sub_account_id, amount = t.to_amount, currency = t.to_currency,
         to_sub_account_id = null, to_amount = null, to_currency = null, rate_used = null, category_id = null,
         source = 'detached_transfer', source_id = null,
         payee = coalesce(nullif(btrim(t.payee), ''), v_label),
         notes = concat_ws(E'\n', nullif(btrim(t.notes), ''), 'Moved from ' || v_label || ', which was deleted')
    from public.sub_accounts o
   where t.user_id = v_user and t.type = 'transfer' and t.sub_account_id = p_sub
     and o.id = t.to_sub_account_id and o.id <> p_sub
     and (p_account is null or o.account_id <> p_account);

  -- money that went TO the deleted balance: expense on the balance it left
  update public.transactions t
     set type = 'expense',
         to_sub_account_id = null, to_amount = null, to_currency = null, rate_used = null, category_id = null,
         source = 'detached_transfer', source_id = null,
         payee = coalesce(nullif(btrim(t.payee), ''), v_label),
         notes = concat_ws(E'\n', nullif(btrim(t.notes), ''), 'Moved to ' || v_label || ', which was deleted')
    from public.sub_accounts o
   where t.user_id = v_user and t.type = 'transfer' and t.to_sub_account_id = p_sub
     and o.id = t.sub_account_id and o.id <> p_sub
     and (p_account is null or o.account_id <> p_account);

  -- records that stay true even though the money movement goes: keep them, drop the link
  -- (otherwise transactions_cleanup would delete the repayment / undo the sale / skip the payout)
  update public.debt_payments x set transaction_id = null
    from public.transactions t where t.id = x.transaction_id and t.user_id = v_user and p_sub in (t.sub_account_id, t.to_sub_account_id);
  update public.debts x set transaction_id = null
    from public.transactions t where t.id = x.transaction_id and t.user_id = v_user and p_sub in (t.sub_account_id, t.to_sub_account_id);
  update public.holding_sales x set transaction_id = null
    from public.transactions t where t.id = x.transaction_id and t.user_id = v_user and p_sub in (t.sub_account_id, t.to_sub_account_id);
  update public.certificate_payouts x set transaction_id = null
    from public.transactions t where t.id = x.transaction_id and t.user_id = v_user and p_sub in (t.sub_account_id, t.to_sub_account_id);
end $$;

-- ---------------------------------------------------------------------------
-- 3. deleting one balance (replaces the old guard that refused)
-- ---------------------------------------------------------------------------
create or replace function public.sub_accounts_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- the whole user is being deleted, or the account is (accounts_before_delete already did the work)
  if not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  if coalesce(current_setting('app.deleting_account', true), '') = old.account_id::text then return old; end if;
  perform set_config('app.deleting_sub', old.id::text, true);
  perform public.detach_sub_account(old.id, null);
  perform set_config('app.deleting_sub', '', true);
  return old;
end $$;

-- ---------------------------------------------------------------------------
-- 4. deleting a whole account: the same for each of its balances, before the cascade
-- ---------------------------------------------------------------------------
create or replace function public.accounts_before_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if not exists (select 1 from auth.users where id = old.user_id) then return old; end if;
  perform set_config('app.deleting_account', old.id::text, true);
  for s in select id from public.sub_accounts where account_id = old.id loop
    perform public.detach_sub_account(s.id, old.id);
  end loop;
  return old;
end $$;
drop trigger if exists accounts_before_delete on public.accounts;
create trigger accounts_before_delete before delete on public.accounts
  for each row execute function public.accounts_before_delete();

-- ---------------------------------------------------------------------------
-- 5. set a balance to what it really is now. The difference goes into the opening balance, so
--    every transaction stays as it is; done in one locked statement, so it is exact even if
--    another device added a transaction meanwhile, and safe to replay from the offline queue.
-- ---------------------------------------------------------------------------
create or replace function public.set_sub_account_balance(p_sub_account_id uuid, p_balance numeric)
returns numeric language plpgsql set search_path = public as $$
declare v numeric;
begin
  if p_balance is null then raise exception 'Enter a balance'; end if;
  update public.sub_accounts
     set opening_balance = opening_balance + (round(p_balance, 4) - balance)
   where id = p_sub_account_id
  returning balance into v;
  if not found then raise exception 'That balance no longer exists'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- permissions (see 0011). detach_sub_account is internal: only the delete triggers call it.
-- ---------------------------------------------------------------------------
revoke execute on function public.apply_transaction_delta(public.transactions, integer) from public, anon;
grant execute on function public.apply_transaction_delta(public.transactions, integer) to authenticated, service_role;
revoke execute on function public.detach_sub_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.detach_sub_account(uuid, uuid) to service_role;
revoke execute on function public.sub_accounts_delete_guard() from public, anon;
grant execute on function public.sub_accounts_delete_guard() to authenticated, service_role;
revoke execute on function public.accounts_before_delete() from public, anon;
grant execute on function public.accounts_before_delete() to authenticated, service_role;
revoke execute on function public.set_sub_account_balance(uuid, numeric) from public, anon;
grant execute on function public.set_sub_account_balance(uuid, numeric) to authenticated, service_role;

-- make the new function visible to the API right away
notify pgrst, 'reload schema';
