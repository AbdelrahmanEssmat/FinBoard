-- Regression tests for migration 0006 (selling holdings). Run on a fresh database with all
-- migrations applied, as postgres. Every check prints PASS or aborts with FAIL.
\set ON_ERROR_STOP on

create function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create function pg_temp.fails(label text, stmt text, pattern text default '%') returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL (no error): %', label;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not ilike pattern then raise exception 'FAIL (wrong error "%"): %', sqlerrm, label; end if;
  raise notice 'PASS: %  [%]', label, sqlerrm;
end $$;

insert into auth.users (id, email) values ('cccccccc-0000-0000-0000-000000000003', 'c@test');
select set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', false);
create temp table ids as
  select (select s.id from sub_accounts s join accounts a on a.id = s.account_id where a.user_id = 'cccccccc-0000-0000-0000-000000000003' and a.name = 'Thndr' and s.currency = 'EGP') as thndr_cash,
         (select s.id from sub_accounts s join accounts a on a.id = s.account_id where a.user_id = 'cccccccc-0000-0000-0000-000000000003' and a.name = 'Cash' and s.currency = 'USD') as cash_usd,
         (select id from accounts where user_id = 'cccccccc-0000-0000-0000-000000000003' and name = 'Thndr') as thndr;
create function pg_temp.bal(p uuid) returns numeric language sql as $$ select balance from public.sub_accounts where id = p $$;

-- a fund: 1000 units bought at 12.50 (12,500), now 14.20
insert into holdings (id, user_id, account_id, name, units, avg_cost, current_price, currency, bought_at, price_updated_at)
values ('80000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003', (select thndr from ids), 'Azimut Fund', 1000, 12.5, 14.2, 'EGP', '2026-03-01', '2026-09-10 12:00+02');

\echo '--- partial sale'
select sell_holding('80000000-0000-0000-0000-000000000001', 400, 15, '2026-09-01', 20, (select thndr_cash from ids), null,
                    '81000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001');
select pg_temp.ok('realized P/L = 400×15 − 20 − 400×12.50 = 980',
  (select realized from holding_sales where id = '81000000-0000-0000-0000-000000000001') = 980);
select pg_temp.ok('proceeds 5980 and cost basis 5000 are stored',
  (select proceeds = 5980 and cost_basis = 5000 and avg_cost = 12.5 from holding_sales where id = '81000000-0000-0000-0000-000000000001'));
select pg_temp.ok('600 units remain and the holding stays open',
  (select units = 600 and closed_at is null from holdings where id = '80000000-0000-0000-0000-000000000001'));
select pg_temp.ok('proceeds land in the Thndr cash balance', pg_temp.bal((select thndr_cash from ids)) = 5980);
select pg_temp.ok('the deposit is tagged as an investment sale',
  (select source::text = 'investment' and type = 'income' and amount = 5980 from transactions where id = '82000000-0000-0000-0000-000000000001'));
select pg_temp.ok('a backdated sale does not overwrite a price typed in later',
  (select current_price = 14.2 from holdings where id = '80000000-0000-0000-0000-000000000001'));
select pg_temp.ok('selling the same sale id twice does nothing',
  sell_holding('80000000-0000-0000-0000-000000000001', 400, 15, '2026-09-01', 20, (select thndr_cash from ids), null,
               '81000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001') = '81000000-0000-0000-0000-000000000001'
  and (select units from holdings where id = '80000000-0000-0000-0000-000000000001') = 600);

\echo '--- guards'
select pg_temp.fails('cannot sell more units than held',
  $q$select sell_holding('80000000-0000-0000-0000-000000000001', 601, 15, '2026-09-02')$q$, '%only hold%');
select pg_temp.fails('proceeds cannot go to an account in another currency',
  format($q$select sell_holding('80000000-0000-0000-0000-000000000001', 10, 15, '2026-09-02', 0, %L)$q$, (select cash_usd from ids)), '%holds USD%');

\echo '--- full sale at a loss'
select sell_holding('80000000-0000-0000-0000-000000000001', 600, 11, '2026-09-20', 0, null, null, '81000000-0000-0000-0000-000000000002');
select pg_temp.ok('loss is negative: 600×11 − 600×12.50 = −900',
  (select realized from holding_sales where id = '81000000-0000-0000-0000-000000000002') = -900);
select pg_temp.ok('the holding is closed with 0 units',
  (select units = 0 and closed_at = '2026-09-20' from holdings where id = '80000000-0000-0000-0000-000000000001'));
select pg_temp.ok('a sale without an account creates no transaction',
  (select transaction_id is null from holding_sales where id = '81000000-0000-0000-0000-000000000002'));
select pg_temp.ok('a sold holding adds nothing to net worth investments',
  (compute_net_worth('cccccccc-0000-0000-0000-000000000003', 'EGP') -> 'by_class' ->> 'investments')::numeric = 0);

\echo '--- undo'
delete from holding_sales where id = '81000000-0000-0000-0000-000000000002';
select pg_temp.ok('deleting a sale puts the units back and reopens the holding',
  (select units = 600 and closed_at is null from holdings where id = '80000000-0000-0000-0000-000000000001'));
delete from transactions where id = '82000000-0000-0000-0000-000000000001';
select pg_temp.ok('deleting a sale''s deposit removes the sale and restores its units',
  not exists (select 1 from holding_sales where id = '81000000-0000-0000-0000-000000000001')
  and (select units from holdings where id = '80000000-0000-0000-0000-000000000001') = 1000);
select pg_temp.ok('the deposit is gone from the balance', pg_temp.bal((select thndr_cash from ids)) = 0);

\echo '--- deleting a sold holding keeps the money'
select sell_holding('80000000-0000-0000-0000-000000000001', 1000, 13, '2026-09-25', 0, (select thndr_cash from ids));
delete from holdings where id = '80000000-0000-0000-0000-000000000001';
select pg_temp.ok('the sale money stays in the account after the holding is deleted', pg_temp.bal((select thndr_cash from ids)) = 13000);
select pg_temp.fails('a balance that received sale money cannot be deleted',
  format('delete from sub_accounts where id = %L', (select thndr_cash from ids)), '%Archive it instead%');
select pg_temp.ok('every stored balance equals opening balance + its transactions',
  not exists (select 1 from sub_accounts s where s.balance <> balance_as_of(s.id, '9999-12-31')));
\echo 'ALL 0006 CHECKS PASSED'
