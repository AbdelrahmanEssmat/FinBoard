-- =============================================================================
-- 0010 – link a credit card to the bank that issued it.
--   accounts.bank_account_id: for a credit card, the bank account it belongs to (optional). Used to
--   name the card ("NBE credit card"), to pay it from that bank by default, and to list a bank's
--   cards on its page. Must be one of your own bank accounts; cleared if that bank is deleted.
-- Safe to run as one transaction and to re-run.
-- =============================================================================

alter table public.accounts add column if not exists bank_account_id uuid references public.accounts(id) on delete set null;

create or replace function public.accounts_bank_link_validate()
returns trigger language plpgsql as $$
declare b record;
begin
  if new.bank_account_id is null then return new; end if;
  if new.type::text <> 'credit_card' then
    new.bank_account_id := null; -- only cards are linked to a bank
    return new;
  end if;
  if new.bank_account_id = new.id then
    raise exception 'A card can''t be linked to itself.';
  end if;
  select user_id, type::text as type into b from public.accounts where id = new.bank_account_id;
  if b is null or b.user_id <> new.user_id then
    raise exception 'That bank account was not found.';
  end if;
  if b.type <> 'bank' then
    raise exception 'A credit card can only be linked to a bank account.';
  end if;
  return new;
end $$;

drop trigger if exists accounts_bank_link_validate on public.accounts;
create trigger accounts_bank_link_validate before insert or update on public.accounts
  for each row execute function public.accounts_bank_link_validate();
