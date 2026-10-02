-- Randomised brute-force test of every money action, run the way the app runs it (API role, user's token).
-- After every action it checks that everything still adds up; it stops at the first broken rule and
-- prints the last actions. Usage (fresh or dev database, as postgres):
--   psql ... -v seed=0.42 -v steps=3000 -f dev-local/fuzz.sql
-- Errors raised on purpose by the app's own checks (SQLSTATE P0001) are listed as "refused";
-- anything else is listed as UNEXPECTED.
\set ON_ERROR_STOP on
\if :{?seed}
\else
  \set seed 0.42
\endif
\if :{?steps}
\else
  \set steps 2000
\endif

select setseed(:seed);
create temp table fz_log (step int, op text, detail text, ok boolean, state text, err text);
create temp table fz_units (holding_id uuid primary key, total numeric not null);
create temp table fz_ctx (k text primary key, v text);
grant all on fz_log, fz_units, fz_ctx to authenticated;

insert into auth.users (id, email) values ('f0000000-0000-0000-0000-00000000f022', 'fuzz@test') on conflict do nothing;
insert into fz_ctx values ('uid', 'f0000000-0000-0000-0000-00000000f022');

create function pg_temp.uid() returns uuid language sql as $$ select 'f0000000-0000-0000-0000-00000000f022'::uuid $$;
create function pg_temp.ri(a int, b int) returns int language sql as $$ select a + floor(random() * (b - a + 1))::int $$;
create function pg_temp.amt() returns numeric language sql as $$
  select case when random() < 0.15 then round((random() * 50000 + 1)::numeric, 2) else round((random() * 3000 + 0.01)::numeric, 2) end $$;
create function pg_temp.dt() returns date language sql as $$ select current_date - pg_temp.ri(-5, 120) $$;
create function pg_temp.sub(cur text default null, exclude uuid default null) returns uuid language sql as $$
  select id from public.sub_accounts where (cur is null or currency = cur) and id is distinct from exclude order by random() limit 1 $$;

-- ---------------------------------------------------------------------------
-- the rules that must hold after every action
-- ---------------------------------------------------------------------------
create function pg_temp.check() returns text language plpgsql as $$
declare r record;
begin
  for r in select s.id, s.balance, public.balance_as_of(s.id, '9999-12-31') as calc from public.sub_accounts s loop
    if r.balance is distinct from r.calc then return format('balance %s is %s but opening + transactions = %s', r.id, r.balance, r.calc); end if;
  end loop;
  for r in select t.id, t.type, t.currency, s.currency as scur, t.to_sub_account_id, t.to_currency, o.currency as ocur, t.amount, t.to_amount
           from public.transactions t join public.sub_accounts s on s.id = t.sub_account_id left join public.sub_accounts o on o.id = t.to_sub_account_id loop
    if r.currency <> r.scur then return format('transaction %s is in %s on a %s balance', r.id, r.currency, r.scur); end if;
    if r.type = 'transfer' and (r.to_sub_account_id is null or r.to_currency is distinct from r.ocur) then return format('transfer %s has a bad destination', r.id); end if;
    if r.type <> 'transfer' and r.to_sub_account_id is not null then return format('%s %s still points at a destination', r.type, r.id); end if;
    if r.amount < 0 or r.to_amount < 0 then return format('transaction %s has a negative amount', r.id); end if;
  end loop;
  for r in select d.id, d.status, d.amount, coalesce(sum(p.amount), 0) as paid from public.debts d left join public.debt_payments p on p.debt_id = d.id group by d.id loop
    if r.status::text <> (case when r.paid >= r.amount then 'settled' else 'open' end) then
      return format('debt %s is %s with %s of %s paid', r.id, r.status, r.paid, r.amount); end if;
  end loop;
  for r in select d.id, d.direction, d.amount, d.currency, d.date, d.sub_account_id, t.id as tid, t.type, t.amount as tamt, t.currency as tcur, t.sub_account_id as tsub, t.date as tdate, t.source
           from public.debts d left join public.transactions t on t.id = d.transaction_id where d.transaction_id is not null loop
    if r.tid is null then return format('debt %s points at a missing transaction', r.id); end if;
    if r.source <> 'debt' or r.type::text <> (case when r.direction = 'i_owe' then 'income' else 'expense' end)
       or r.tamt <> r.amount or r.tcur <> r.currency or r.tdate <> r.date or r.tsub is distinct from r.sub_account_id then
      return format('debt %s (%s %s %s on %s, %s) and its transaction (%s %s %s on %s, %s) disagree', r.id, r.direction, r.amount, r.currency, r.date, r.sub_account_id, r.type, r.tamt, r.tcur, r.tdate, r.tsub);
    end if;
  end loop;
  for r in select p.id, d.direction, p.amount, p.sub_account_id, t.type, t.amount as tamt, t.sub_account_id as tsub
           from public.debt_payments p join public.debts d on d.id = p.debt_id join public.transactions t on t.id = p.transaction_id loop
    if r.type::text <> (case when r.direction = 'owed_to_me' then 'income' else 'expense' end) or r.tamt <> r.amount or r.tsub is distinct from r.sub_account_id then
      return format('repayment %s and its transaction disagree', r.id); end if;
  end loop;
  for r in select t.id from public.transactions t where t.source = 'debt'
           and not exists (select 1 from public.debts d where d.transaction_id = t.id)
           and not exists (select 1 from public.debt_payments p where p.transaction_id = t.id) loop
    return format('debt transaction %s belongs to no debt or repayment', r.id);
  end loop;
  for r in select h.id, h.units, coalesce((select sum(units) from public.holding_sales s where s.holding_id = h.id), 0) as sold, u.total
           from public.holdings h join fz_units u on u.holding_id = h.id loop
    if r.units + r.sold <> r.total then return format('holding %s: %s held + %s sold <> %s bought', r.id, r.units, r.sold, r.total); end if;
  end loop;
  for r in select s.id, s.proceeds, s.sub_account_id, t.amount, t.type, t.sub_account_id as tsub from public.holding_sales s join public.transactions t on t.id = s.transaction_id loop
    if r.type <> 'income' or r.amount <> r.proceeds or r.tsub is distinct from r.sub_account_id then return format('sale %s and its deposit disagree', r.id); end if;
  end loop;
  for r in select p.id, p.status, p.amount, p.transaction_id, t.amount as tamt, t.source, t.source_id from public.certificate_payouts p left join public.transactions t on t.id = p.transaction_id loop
    if r.status <> 'logged' and r.transaction_id is not null then return format('payout %s is %s but has an income', r.id, r.status); end if;
    if r.transaction_id is not null and (r.tamt <> r.amount or r.source <> 'certificate' or r.source_id <> r.id) then return format('payout %s and its income disagree', r.id); end if;
  end loop;
  for r in select p.id, p.fees, t.amount from public.card_installment_plans p join public.transactions t on t.id = p.fees_transaction_id loop
    if r.fees <> r.amount then return format('plan %s says fees %s but its fee expense is %s', r.id, r.fees, r.amount); end if;
  end loop;
  for r in select c.id from public.categories c join public.categories p on p.id = c.parent_id where p.parent_id is not null or p.kind <> c.kind loop
    return format('category %s is three levels deep or under the other kind', r.id);
  end loop;
  for r in select p.id, p.amount, p.period_start, p.due_date from public.certificate_payouts p where p.period_start is null or p.period_start >= p.due_date or p.amount <= 0 loop
    return format('payout %s has a bad period (%s to %s) or amount %s', r.id, r.period_start, r.due_date, r.amount);
  end loop;
  for r in select s.id from public.sub_accounts s where s.yield_rate is not null and not exists (select 1 from public.yield_rates y where y.sub_account_id = s.id) loop
    return format('Cloud %s has no rate history', r.id);
  end loop;
  for r in select sub_account_id, date from public.transactions where source = 'yield' group by 1, 2 having count(*) > 1 loop
    return format('Cloud %s got interest twice on %s', r.sub_account_id, r.date);
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- one random action; returns a description (raises on refusal)
-- ---------------------------------------------------------------------------
create function pg_temp.act(op text) returns text language plpgsql as $$
declare
  u uuid := pg_temp.uid();
  s1 uuid; s2 uuid; c1 text; c2 text; a numeric; id1 uuid := gen_random_uuid(); id2 uuid := gen_random_uuid(); id3 uuid := gen_random_uuid();
  r record; n int; acct uuid;
begin
  case op
  when 'tx' then
    s1 := pg_temp.sub(); select currency into c1 from public.sub_accounts where id = s1;
    insert into public.transactions (user_id, type, date, amount, currency, sub_account_id, category_id)
    values (u, case when random() < 0.6 then 'expense' else 'income' end::transaction_type, pg_temp.dt(), pg_temp.amt(), c1, s1,
            (select id from public.categories order by random() limit 1));
    return 'income/expense on ' || s1;
  when 'transfer' then
    s1 := pg_temp.sub(); s2 := pg_temp.sub(null, s1);
    select currency into c1 from public.sub_accounts where id = s1; select currency into c2 from public.sub_accounts where id = s2;
    a := pg_temp.amt();
    insert into public.transactions (user_id, type, date, amount, currency, sub_account_id, to_sub_account_id, to_amount, to_currency)
    values (u, 'transfer', pg_temp.dt(), a, c1, s1, s2, case when c1 = c2 then a else round(a / 48.5, 2) + 0.01 end, c2);
    return format('transfer %s -> %s', s1, s2);
  when 'edit_tx' then
    -- like the app: installment purchases and their fees are managed by their plan, not edited directly
    select * into r from public.transactions t where source in ('manual', 'recurring', 'detached_transfer', 'adjustment')
      and not exists (select 1 from public.card_installment_plans p where t.id in (p.transaction_id, p.fees_transaction_id)) order by random() limit 1;
    if not found then return 'no transaction'; end if;
    n := pg_temp.ri(1, 5);
    if n = 1 then
      update public.transactions set amount = pg_temp.amt(), to_amount = case when type = 'transfer' then case when currency = to_currency then null else pg_temp.amt() end end where id = r.id;
      update public.transactions set to_amount = amount where id = r.id and type = 'transfer' and to_amount is null;
    elsif n = 2 then update public.transactions set date = pg_temp.dt() where id = r.id;
    elsif n = 3 then
      s1 := pg_temp.sub(null, r.to_sub_account_id); select currency into c1 from public.sub_accounts where id = s1;
      update public.transactions set sub_account_id = s1, currency = c1,
        to_amount = case when type = 'transfer' then case when c1 = to_currency then amount else to_amount end end where id = r.id;
    elsif n = 4 and r.type <> 'transfer' then
      update public.transactions set type = case when type = 'income' then 'expense' else 'income' end::transaction_type where id = r.id;
    elsif n = 4 then
      update public.transactions set type = 'expense', to_sub_account_id = null, to_amount = null, to_currency = null where id = r.id;
    else
      s2 := pg_temp.sub(null, r.sub_account_id); select currency into c2 from public.sub_accounts where id = s2;
      update public.transactions set type = 'transfer', to_sub_account_id = s2, to_currency = c2,
        to_amount = case when c2 = currency then amount else round(amount / 48.5, 2) + 0.01 end where id = r.id;
    end if;
    return format('edit %s (variant %s)', r.id, n);
  when 'delete_tx' then
    select id, source into r from public.transactions order by random() limit 1;
    if not found then return 'no transaction'; end if;
    delete from public.transactions where id = r.id;
    return format('delete %s transaction %s', r.source, r.id);
  when 'debt' then
    select id into id2 from public.contacts order by random() limit 1;
    if id2 is null or random() < 0.3 then id2 := gen_random_uuid(); insert into public.contacts (id, user_id, name) values (id2, u, 'P' || pg_temp.ri(1, 999)); end if;
    c1 := case when random() < 0.7 then 'EGP' else 'USD' end; a := pg_temp.amt();
    s1 := case when random() < 0.7 then pg_temp.sub(c1) end;
    if s1 is not null then
      insert into public.transactions (id, user_id, type, date, amount, currency, sub_account_id, source, source_id)
      values (id1, u, case when random() < 0.5 then 'income' else 'expense' end::transaction_type, current_date - 3, a, c1, s1, 'debt', id3);
    end if;
    insert into public.debts (id, user_id, contact_id, direction, amount, currency, date, sub_account_id, transaction_id)
    select id3, u, id2, case when t.type = 'income' or (t.type is null and random() < 0.5) then 'i_owe' else 'owed_to_me' end::debt_direction,
           a, c1, current_date - 3, s1, case when s1 is not null then id1 end
    from (select (select type from public.transactions where id = id1) as type) t;
    return 'new debt' || case when s1 is null then '' else ' moving money' end;
  when 'edit_debt' then
    select * into r from public.debts order by random() limit 1;
    if not found then return 'no debt'; end if;
    if random() < 0.6 then update public.debts set amount = pg_temp.amt() where id = r.id;
    else update public.debts set date = pg_temp.dt() where id = r.id; end if;
    return 'edit debt ' || r.id;
  when 'repay' then
    select d.*, d.amount - coalesce((select sum(amount) from public.debt_payments p where p.debt_id = d.id), 0) as left_ into r
      from public.debts d where d.status = 'open' order by random() limit 1;
    if not found then return 'no open debt'; end if;
    a := case when random() < 0.3 then r.left_ when random() < 0.1 then r.left_ + 1 else round((r.left_ * random())::numeric, 2) end;
    perform public.record_debt_payment(r.id, greatest(a, 0.01), pg_temp.dt(), case when random() < 0.8 then pg_temp.sub(r.currency) end);
    return format('repay %s of %s left', a, r.left_);
  when 'delete_payment' then
    select id into id1 from public.debt_payments order by random() limit 1; if id1 is null then return 'none'; end if;
    delete from public.debt_payments where id = id1; return 'delete repayment';
  when 'delete_debt' then
    select id into id1 from public.debts order by random() limit 1; if id1 is null then return 'none'; end if;
    delete from public.debts where id = id1; return 'delete debt';
  when 'delete_contact' then
    select id into id1 from public.contacts order by random() limit 1; if id1 is null then return 'none'; end if;
    delete from public.contacts where id = id1; return 'delete contact';
  when 'holding' then
    select id into acct from public.accounts order by random() limit 1;
    a := pg_temp.ri(1, 500);
    insert into public.holdings (id, user_id, account_id, name, units, avg_cost, current_price, currency, bought_at)
    values (id1, u, acct, 'H' || pg_temp.ri(1, 999), a, pg_temp.amt() / 10, pg_temp.amt() / 10, case when random() < 0.7 then 'EGP' else 'USD' end, current_date - 200);
    insert into fz_units values (id1, a);
    return 'new holding';
  when 'edit_holding' then
    select * into r from public.holdings order by random() limit 1; if not found then return 'none'; end if;
    a := pg_temp.ri(0, 600);
    update public.holdings set units = a, avg_cost = pg_temp.amt() / 10, current_price = pg_temp.amt() / 10 where id = r.id;
    update fz_units set total = a + coalesce((select sum(units) from public.holding_sales where holding_id = r.id), 0) where holding_id = r.id;
    return 'edit holding';
  when 'sell' then
    select * into r from public.holdings where units > 0 order by random() limit 1; if not found then return 'none'; end if;
    a := case when random() < 0.3 then r.units when random() < 0.05 then r.units + 1 else greatest(round((r.units * random())::numeric, 2), 0.01) end;
    perform public.sell_holding(r.id, a, pg_temp.amt() / 10, pg_temp.dt(), case when random() < 0.3 then round((random() * 20)::numeric, 2) else 0 end,
                                case when random() < 0.8 then pg_temp.sub(r.currency) end);
    return format('sell %s of %s', a, r.units);
  when 'delete_sale' then
    select id into id1 from public.holding_sales order by random() limit 1; if id1 is null then return 'none'; end if;
    delete from public.holding_sales where id = id1; return 'delete sale';
  when 'delete_holding' then
    select id into id1 from public.holdings order by random() limit 1; if id1 is null then return 'none'; end if;
    delete from public.holdings where id = id1; delete from fz_units where holding_id = id1; return 'delete holding';
  when 'certificate' then
    select id into acct from public.accounts order by random() limit 1;
    c1 := case when random() < 0.8 then 'EGP' else 'USD' end;
    n := pg_temp.ri(0, 500);
    insert into public.certificates (id, user_id, account_id, name, principal, currency, interest_rate, payout_frequency, start_date, maturity_date, payout_sub_account_id, auto_log_income)
    values (id1, u, acct, 'C', round((random() * 200000 + 1000)::numeric, 0), c1, round((random() * 30)::numeric, 2),
            (array['monthly','quarterly','semi_annual','annual','at_maturity'])[pg_temp.ri(1, 5)]::payout_frequency,
            current_date - n, current_date - n + pg_temp.ri(30, 1500), case when random() < 0.8 then pg_temp.sub(case when random() < 0.9 then c1 end) end, random() < 0.7);
    return 'new certificate';
  when 'log_payouts' then
    if random() < 0.5 then perform public.process_certificate_payouts(u); return 'nightly payouts'; end if;
    select p.id into id1 from public.certificate_payouts p where p.status = 'pending' and p.due_date <= current_date order by random() limit 1;
    if id1 is null then return 'none'; end if;
    perform public.log_certificate_payout(id1, pg_temp.sub()); return 'log one payout';
  when 'edit_certificate' then
    select * into r from public.certificates order by random() limit 1; if not found then return 'none'; end if;
    n := pg_temp.ri(1, 5);
    if n = 1 then update public.certificates set principal = principal * 2 where id = r.id;
    elsif n = 2 then update public.certificates set interest_rate = round((random() * 30)::numeric, 2) where id = r.id;
    elsif n = 3 then update public.certificates set maturity_date = start_date + pg_temp.ri(30, 1500) where id = r.id;
    elsif n = 4 then update public.certificates set notes = 'n' || pg_temp.ri(1, 99) where id = r.id;
    else update public.certificates set payout_sub_account_id = pg_temp.sub(r.currency), is_closed = random() < 0.2 where id = r.id; end if;
    return format('edit certificate (variant %s)', n);
  when 'skip_payout' then
    select id, status into r from public.certificate_payouts where status in ('pending', 'skipped') order by random() limit 1; if not found then return 'none'; end if;
    update public.certificate_payouts set status = case when r.status = 'pending' then 'skipped' else 'pending' end::payout_status where id = r.id;
    return 'toggle skip';
  when 'delete_certificate' then
    select id into id1 from public.certificates order by random() limit 1; if id1 is null then return 'none'; end if;
    delete from public.certificates where id = id1; return 'delete certificate';
  when 'set_balance' then
    s1 := pg_temp.sub(); if s1 is null then return 'none'; end if;
    perform public.set_sub_account_balance(s1, round((random() * 100000 - 20000)::numeric, 2)); return 'set balance';
  when 'archive' then
    update public.sub_accounts set is_archived = not is_archived where id = pg_temp.sub(); return 'archive toggle';
  when 'delete_sub' then
    if (select count(*) from public.sub_accounts) < 5 then return 'kept'; end if;
    s1 := pg_temp.sub(); delete from public.sub_accounts where id = s1; return 'delete balance ' || s1;
  when 'delete_account' then
    if (select count(*) from public.accounts) < 4 then return 'kept'; end if;
    select id into acct from public.accounts order by random() limit 1; delete from public.accounts where id = acct; return 'delete account ' || acct;
  when 'account' then
    insert into public.accounts (id, user_id, name, type) values (id1, u, 'A' || pg_temp.ri(1, 999),
      (array['bank','cash','investment','wallet','credit_card'])[pg_temp.ri(1, 5)]::account_type);
    insert into public.sub_accounts (user_id, account_id, currency, opening_balance, yield_rate, yield_frequency, yield_since)
    select u, id1, c, round((random() * 20000)::numeric, 2), y, case when y is not null then (array['daily','monthly'])[pg_temp.ri(1, 2)]::recurrence end, case when y is not null then current_date - pg_temp.ri(0, 60) end
    from (select case when random() < 0.7 then 'EGP' else 'USD' end as c, case when random() < 0.25 then round((random() * 25)::numeric, 2) end as y) x;
    if random() < 0.3 then insert into public.sub_accounts (user_id, account_id, currency, opening_balance) values (u, id1, 'USD', 100); end if;
    return 'new account';
  when 'recurring' then
    s1 := pg_temp.sub(); select currency into c1 from public.sub_accounts where id = s1;
    s2 := case when random() < 0.3 then pg_temp.sub(null, s1) end; select currency into c2 from public.sub_accounts where id = s2;
    a := pg_temp.amt();
    insert into public.recurring_transactions (user_id, name, type, amount, currency, sub_account_id, to_sub_account_id, to_amount, to_currency, frequency, interval_count, next_date, end_date, auto_post)
    values (u, 'R', case when s2 is not null then 'transfer' when random() < 0.7 then 'expense' else 'income' end::transaction_type, a, c1, s1, s2,
            case when s2 is not null then case when c1 = c2 then a else round(a / 48.5, 2) + 0.01 end end, c2,
            (array['daily','weekly','monthly','yearly'])[pg_temp.ri(1, 4)]::recurrence, pg_temp.ri(1, 3), current_date - pg_temp.ri(-10, 100),
            case when random() < 0.3 then current_date + pg_temp.ri(-30, 60) end, random() < 0.8);
    return 'new recurring rule';
  when 'edit_recurring' then
    select id into id1 from public.recurring_transactions order by random() limit 1; if id1 is null then return 'none'; end if;
    update public.recurring_transactions set amount = pg_temp.amt(), to_amount = case when to_currency = currency then null else to_amount end,
      next_date = case when random() < 0.5 then current_date - pg_temp.ri(-10, 40) else next_date end where id = id1;
    update public.recurring_transactions set to_amount = amount where id = id1 and type = 'transfer' and to_amount is null;
    return 'edit recurring';
  when 'delete_recurring' then
    select id into id1 from public.recurring_transactions order by random() limit 1; if id1 is null then return 'none'; end if;
    delete from public.recurring_transactions where id = id1; return 'delete recurring';
  when 'post_recurring' then
    perform public.post_due_recurring(u);
    select count(*) into n from public.transactions;
    perform public.post_due_recurring(u);
    if (select count(*) from public.transactions) <> n then raise exception 'FUZZ: posting recurring twice added transactions'; end if;
    return 'post recurring (twice)';
  when 'accrue' then
    perform public.accrue_yield(u); n := (select count(*) from public.transactions);
    perform public.accrue_yield(u);
    if (select count(*) from public.transactions) <> n then raise exception 'FUZZ: accruing twice added interest'; end if;
    return 'accrue yield (twice)';
  when 'plan' then
    select s.id, s.account_id, s.currency into r from public.sub_accounts s join public.accounts a2 on a2.id = s.account_id where a2.type = 'credit_card' order by random() limit 1;
    if not found then return 'no card'; end if;
    a := pg_temp.amt() + 100;
    insert into public.transactions (id, user_id, type, date, amount, currency, sub_account_id) values (id1, u, 'expense', current_date - 10, a, r.currency, r.id);
    if random() < 0.6 then insert into public.transactions (id, user_id, type, date, amount, currency, sub_account_id) values (id2, u, 'expense', current_date - 10, round(a * 0.1, 2), r.currency, r.id); else id2 := null; end if;
    insert into public.card_installment_plans (user_id, account_id, sub_account_id, transaction_id, fees_transaction_id, description, currency, principal, fees, months, purchase_date, first_billing_date)
    values (u, r.account_id, r.id, id1, id2, 'P', r.currency, a, case when id2 is null then 0 else round(a * 0.1, 2) end, pg_temp.ri(2, 24), current_date - 10, current_date + 5);
    return 'new installment plan';
  when 'close_plan' then
    update public.card_installment_plans set closed_at = current_date where id = (select id from public.card_installment_plans where closed_at is null order by random() limit 1);
    return 'settle plan early';
  when 'delete_plan' then
    delete from public.card_installment_plans where id = (select id from public.card_installment_plans order by random() limit 1); return 'delete plan';
  when 'currency_change' then
    s1 := pg_temp.sub(); update public.sub_accounts set currency = case when currency = 'EGP' then 'USD' else 'EGP' end where id = s1;
    return 'change a balance''s currency ' || s1;
  when 'delete_category' then
    delete from public.categories where id = (select id from public.categories order by random() limit 1); return 'delete category';
  when 'pause_recurring' then
    update public.recurring_transactions set is_active = not is_active where id = (select id from public.recurring_transactions order by random() limit 1);
    return 'pause/resume recurring';
  when 'cloud_switch' then
    update public.sub_accounts set yield_frequency = case when yield_frequency = 'daily' then 'monthly' else 'daily' end::recurrence
     where id = (select id from public.sub_accounts where yield_rate is not null order by random() limit 1);
    return 'switch Cloud frequency';
  when 'cloud_balance' then
    s1 := (select id from public.sub_accounts where yield_rate is not null order by random() limit 1); if s1 is null then return 'none'; end if;
    perform public.set_sub_account_balance(s1, round((random() * 50000)::numeric, 2)); return 'correct a Cloud balance';
  when 'reparent' then
    update public.categories set parent_id = (select id from public.categories order by random() limit 1)
     where id = (select id from public.categories order by random() limit 1);
    return 'move a category';
  when 'debt_rpc' then
    c1 := case when random() < 0.7 then 'EGP' else 'USD' end;
    s1 := case when random() < 0.7 then pg_temp.sub(c1) end;
    select id into id2 from public.contacts order by random() limit 1;
    a := pg_temp.amt();
    if id2 is null or random() < 0.4 then
      perform public.create_debt(id3, id1, 'Q' || pg_temp.ri(1, 999), (array['i_owe','owed_to_me'])[pg_temp.ri(1, 2)]::debt_direction, a, c1, pg_temp.dt(),
        null, null, null, null, null, null, null, s1, gen_random_uuid());
    else
      perform public.create_debt(id3, id2, null, (array['i_owe','owed_to_me'])[pg_temp.ri(1, 2)]::debt_direction, a, c1, pg_temp.dt(),
        null, null, null, case when random() < 0.3 then pg_temp.ri(2, 6) end, null, 'monthly', current_date + 30, s1, id1);
    end if;
    return 'one-step debt' || case when s1 is null then '' else ' moving money' end;
  when 'plan_rpc' then
    select s.id into s1 from public.sub_accounts s join public.accounts a2 on a2.id = s.account_id where a2.type = 'credit_card' order by random() limit 1;
    if s1 is null then return 'no card'; end if;
    a := pg_temp.amt() + 100;
    perform public.create_installment_purchase(id1, id2, id3, s1, 'P', null, null, a, case when random() < 0.6 then round(a * 0.1, 2) else 0 end,
      pg_temp.ri(2, 24), current_date - pg_temp.ri(0, 20), current_date + 5, null);
    return 'one-step installment purchase';
  when 'cloud_rate' then
    update public.sub_accounts set yield_rate = round((random() * 30)::numeric, 2)
     where id = (select id from public.sub_accounts where yield_rate is not null order by random() limit 1);
    return 'change a Cloud rate';
  when 'cert_freq' then
    update public.certificates set payout_frequency = (array['monthly','quarterly','semi_annual','annual','at_maturity'])[pg_temp.ri(1, 5)]::payout_frequency
     where id = (select id from public.certificates order by random() limit 1);
    return 'change a certificate payout frequency';
  when 'tz' then
    update public.settings set timezone = (array['Africa/Cairo','Europe/London','Asia/Dubai','America/New_York','Pacific/Kiritimati'])[pg_temp.ri(1, 5)]
     where user_id = u;
    return 'change time zone';
  when 'net_worth' then
    perform public.snapshot_net_worth(u, current_date); perform public.compute_net_worth(u, 'EGP', current_date); return 'net worth';
  end case;
  return 'unknown op ' || op;
end $$;

create function pg_temp.run(steps int) returns text language plpgsql as $$
declare
  ops text[] := array['tx','tx','tx','tx','tx','tx','transfer','transfer','transfer','transfer','edit_tx','edit_tx','edit_tx','edit_tx','delete_tx','delete_tx','delete_tx',
    'debt','debt','edit_debt','repay','repay','repay','delete_payment','delete_debt','delete_contact','holding','holding','edit_holding','sell','sell','delete_sale','delete_holding',
    'certificate','log_payouts','log_payouts','edit_certificate','skip_payout','delete_certificate','set_balance','set_balance','archive','delete_sub','delete_account','account','account',
    'recurring','edit_recurring','delete_recurring','post_recurring','accrue','plan','close_plan','delete_plan','currency_change','delete_category','net_worth',
    'pause_recurring','cloud_switch','cloud_balance','reparent','accrue',
    'debt_rpc','debt_rpc','plan_rpc','cloud_rate','cert_freq','cert_freq','log_payouts','tz'];
  op text; d text; bad text; i int; ctx text;
begin
  for i in 1..steps loop
    op := ops[pg_temp.ri(1, array_length(ops, 1))];
    begin
      d := pg_temp.act(op);
      insert into fz_log values (i, op, d, true, null, null);
    exception when others then
      get stacked diagnostics ctx = pg_exception_context;
      insert into fz_log values (i, op, substring(ctx from 'act(text) line (d+)'), false, sqlstate, sqlerrm);
    end;
    bad := pg_temp.check();
    if bad is not null then return format('BROKEN after step %s (%s): %s', i, op, bad); end if;
  end loop;
  return format('ALL %s STEPS OK', steps);
end $$;

-- run as the app does
set session authorization authenticator;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-0000-0000-00000000f022","role":"authenticated"}', false);
-- a credit card and a second currency to start with
insert into public.accounts (id, user_id, name, type) values ('f0000000-0000-0000-0000-0000000000c1', pg_temp.uid(), 'Card', 'credit_card');
insert into public.sub_accounts (user_id, account_id, currency, opening_balance) values (pg_temp.uid(), 'f0000000-0000-0000-0000-0000000000c1', 'EGP', -500);
insert into public.accounts (id, user_id, name, type) values ('f0000000-0000-0000-0000-0000000000b1', pg_temp.uid(), 'Bank', 'bank');
insert into public.sub_accounts (user_id, account_id, currency, opening_balance) values (pg_temp.uid(), 'f0000000-0000-0000-0000-0000000000b1', 'EGP', 50000), (pg_temp.uid(), 'f0000000-0000-0000-0000-0000000000b1', 'USD', 1000);

\pset format unaligned
\pset tuples_only on
select pg_temp.run(:steps);
\echo '--- last actions'
select step || ' ' || op || ' ' || case when ok then 'ok: ' || coalesce(detail, '') else 'FAILED ' || state || ': ' || err end from fz_log order by step desc limit 8;
\echo '--- actions'
select op || ': ' || count(*) filter (where ok) || ' ok, ' || count(*) filter (where not ok) || ' refused' from fz_log group by op order by op;
\echo '--- UNEXPECTED errors (not an app check)'
select state || ' x' || count(*) || ' [' || min(op) || ' at act line ' || string_agg(distinct detail, ',') || '] ' || left(err, 160) from fz_log where not ok and state <> 'P0001' group by state, left(err, 160) order by count(*) desc;
\echo '--- refusals by the app''s own checks'
select 'x' || count(*) || ' [' || string_agg(distinct op, ',') || '] ' || regexp_replace(left(err, 120), '[0-9.]+', '#', 'g') from fz_log where not ok and state = 'P0001' group by regexp_replace(left(err, 120), '[0-9.]+', '#', 'g') order by count(*) desc;
reset role;
reset session authorization;
