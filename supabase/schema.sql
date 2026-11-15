-- Iron Vault: Supabase schema.
-- Run once in the Supabase SQL editor (Dashboard > SQL Editor > New query > Run).
--
-- Model: one row per character ("vault"). Anyone can read. Nobody can write to the table
-- directly: uploads go through upload_vault(), which checks the vault's secret code.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.vaults (
  id            uuid primary key default gen_random_uuid(),
  character     text not null,
  character_key text generated always as (lower(character)) stored unique,
  -- Challenge set as a bitmask: 1 = Hardcore, 2 = Ironman, 4 = Bloodthirsty.
  mask          smallint not null check (mask between 1 and 7),
  note          text not null default '' check (char_length(note) <= 120),
  -- Array of [itemId, suffixId, count, quality, stackSize, equipSlot, icon, type, subtype, name].
  items         jsonb not null default '[]'::jsonb,
  code_hash     text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists vaults_mask_idx on public.vaults (mask, updated_at desc);

alter table public.vaults enable row level security;

drop policy if exists "vaults are public" on public.vaults;
create policy "vaults are public" on public.vaults
  for select to anon, authenticated using (true);

-- Read access to everything except code_hash; no direct insert, update or delete.
revoke all on public.vaults from anon, authenticated;
grant select (id, character, mask, note, items, updated_at) on public.vaults to anon, authenticated;

-- Create a vault (returns its new secret code) or replace an existing one (needs the code).
create or replace function public.upload_vault(
  p_character text,
  p_mask      int,
  p_items     jsonb,
  p_code      text default null,
  p_note      text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v       public.vaults%rowtype;
  v_name  text := btrim(coalesce(p_character, ''));
  v_note  text := left(btrim(coalesce(p_note, '')), 120);
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_new   text;
begin
  if v_name !~ '^[A-Za-zÀ-ÿ]{2,12}$' then
    raise exception 'invalid_character';
  end if;
  v_name := upper(left(v_name, 1)) || lower(substr(v_name, 2));

  if p_mask is null or p_mask < 1 or p_mask > 7 then
    raise exception 'invalid_mask';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) > 1500
     or octet_length(p_items::text) > 300000 then
    raise exception 'invalid_items';
  end if;

  select * into v from public.vaults where character_key = lower(v_name);

  if found then
    if v_code = '' or v.code_hash <> crypt(v_code, v.code_hash) then
      perform pg_sleep(1);            -- slows down code guessing
      raise exception 'wrong_code';
    end if;
    update public.vaults
       set mask = p_mask, note = v_note, items = p_items, updated_at = now()
     where id = v.id;
    return jsonb_build_object('character', v_name, 'code', null, 'count', jsonb_array_length(p_items));
  end if;

  -- Brake on mass registration: at most 40 new vaults per hour, site-wide.
  if (select count(*) from public.vaults where created_at > now() - interval '1 hour') >= 40 then
    raise exception 'too_many_new_vaults';
  end if;

  v_new := upper(encode(gen_random_bytes(6), 'hex'));
  v_new := substr(v_new, 1, 4) || '-' || substr(v_new, 5, 4) || '-' || substr(v_new, 9, 4);

  insert into public.vaults (character, mask, note, items, code_hash)
  values (v_name, p_mask, v_note, p_items, crypt(v_new, gen_salt('bf', 8)));

  return jsonb_build_object('character', v_name, 'code', v_new, 'count', jsonb_array_length(p_items));
end;
$$;

-- Remove a vault. Needs its code.
create or replace function public.delete_vault(p_character text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v      public.vaults%rowtype;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  select * into v from public.vaults where character_key = lower(btrim(coalesce(p_character, '')));
  if not found then
    raise exception 'not_found';
  end if;
  if v_code = '' or v.code_hash <> crypt(v_code, v.code_hash) then
    perform pg_sleep(1);
    raise exception 'wrong_code';
  end if;
  delete from public.vaults where id = v.id;
  return jsonb_build_object('character', v.character, 'deleted', true);
end;
$$;

revoke all on function public.upload_vault(text, int, jsonb, text, text) from public;
revoke all on function public.delete_vault(text, text) from public;
grant execute on function public.upload_vault(text, int, jsonb, text, text) to anon, authenticated;
grant execute on function public.delete_vault(text, text) to anon, authenticated;

-- Moderation, from the SQL editor (you are the admin there):
--   delete from public.vaults where character = 'Somename';
-- Housekeeping, vaults nobody refreshed in 90 days:
--   delete from public.vaults where updated_at < now() - interval '90 days';
