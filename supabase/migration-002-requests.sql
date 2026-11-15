-- Iron Vault: migration 002. Adds the public request log and the race of each character.
-- Run once in the Supabase SQL editor (Dashboard > SQL Editor > New query > Run).
-- Safe to run again. It does not touch the lists already uploaded.

-- 1. Race and sex of the donor character (optional, shown as an icon).
alter table public.vaults add column if not exists race text
  check (race is null or race in ('human','dwarf','nightelf','gnome','draenei','orc','scourge','tauren','troll','bloodelf'));
alter table public.vaults add column if not exists gender text
  check (gender is null or gender in ('male','female'));

revoke all on public.vaults from anon, authenticated;
grant select (id, character, mask, note, items, updated_at, race, gender) on public.vaults to anon, authenticated;

-- 2. upload_vault() gains p_race and p_gender. The old five-argument version is replaced.
drop function if exists public.upload_vault(text, int, jsonb, text, text);

create or replace function public.upload_vault(
  p_character text,
  p_mask      int,
  p_items     jsonb,
  p_code      text default null,
  p_note      text default '',
  p_race      text default null,
  p_gender    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v        public.vaults%rowtype;
  v_name   text := btrim(coalesce(p_character, ''));
  v_note   text := left(btrim(coalesce(p_note, '')), 120);
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_race   text := nullif(lower(btrim(coalesce(p_race, ''))), '');
  v_gender text := nullif(lower(btrim(coalesce(p_gender, ''))), '');
  v_new    text;
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
  if v_race is not null and v_race not in ('human','dwarf','nightelf','gnome','draenei','orc','scourge','tauren','troll','bloodelf') then
    v_race := null;
  end if;
  if v_gender is not null and v_gender not in ('male','female') then
    v_gender := null;
  end if;

  select * into v from public.vaults where character_key = lower(v_name);

  if found then
    if v_code = '' or v.code_hash <> crypt(v_code, v.code_hash) then
      perform pg_sleep(1);            -- slows down code guessing
      raise exception 'wrong_code';
    end if;
    update public.vaults
       set mask = p_mask, note = v_note, items = p_items, updated_at = now(),
           race = coalesce(v_race, race), gender = coalesce(v_gender, gender)
     where id = v.id;
    return jsonb_build_object('character', v_name, 'code', null, 'count', jsonb_array_length(p_items));
  end if;

  -- Brake on mass registration: at most 40 new vaults per hour, site-wide.
  if (select count(*) from public.vaults where created_at > now() - interval '1 hour') >= 40 then
    raise exception 'too_many_new_vaults';
  end if;

  v_new := upper(encode(gen_random_bytes(6), 'hex'));
  v_new := substr(v_new, 1, 4) || '-' || substr(v_new, 5, 4) || '-' || substr(v_new, 9, 4);

  insert into public.vaults (character, mask, note, items, code_hash, race, gender)
  values (v_name, p_mask, v_note, p_items, crypt(v_new, gen_salt('bf', 8)), v_race, v_gender);

  return jsonb_build_object('character', v_name, 'code', v_new, 'count', jsonb_array_length(p_items));
end;
$$;

revoke all on function public.upload_vault(text, int, jsonb, text, text, text, text) from public;
grant execute on function public.upload_vault(text, int, jsonb, text, text, text, text) to anon, authenticated;

-- 3. Request log: one row each time a player prepares a request for a donor.
--    It records what was asked on the site, not what was actually traded in game.
create table if not exists public.requests (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  mask          smallint not null check (mask between 1 and 7),
  requester     text not null,
  race          text,
  gender        text,
  donor         text not null,
  donor_race    text,
  donor_gender  text,
  -- Array of [itemId, quantity, quality, name, icon], copied from the donor's list by log_request().
  items         jsonb not null default '[]'::jsonb
);

create index if not exists requests_mask_idx on public.requests (mask, created_at desc);

alter table public.requests enable row level security;

drop policy if exists "requests are public" on public.requests;
create policy "requests are public" on public.requests
  for select to anon, authenticated using (true);

revoke all on public.requests from anon, authenticated;
grant select on public.requests to anon, authenticated;

-- Writes one log row. The caller sends only ids and quantities: names, qualities and icons are
-- taken from the donor's own list, so no free text can be injected into the public log.
create or replace function public.log_request(
  p_requester text,
  p_donor     text,
  p_items     jsonb,
  p_race      text default null,
  p_gender    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v        public.vaults%rowtype;
  v_name   text := btrim(coalesce(p_requester, ''));
  v_race   text := nullif(lower(btrim(coalesce(p_race, ''))), '');
  v_gender text := nullif(lower(btrim(coalesce(p_gender, ''))), '');
  v_items  jsonb;
  v_id     bigint;
begin
  if v_name !~ '^[A-Za-zÀ-ÿ]{2,12}$' then
    raise exception 'invalid_character';
  end if;
  v_name := upper(left(v_name, 1)) || lower(substr(v_name, 2));
  if v_race is not null and v_race not in ('human','dwarf','nightelf','gnome','draenei','orc','scourge','tauren','troll','bloodelf') then
    v_race := null;
  end if;
  if v_gender is not null and v_gender not in ('male','female') then
    v_gender := null;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 8 then
    raise exception 'invalid_items';
  end if;

  select * into v from public.vaults where character_key = lower(btrim(coalesce(p_donor, '')));
  if not found then
    raise exception 'not_found';
  end if;
  if lower(v.character) = lower(v_name) then
    raise exception 'invalid_character';
  end if;

  -- Keep only items the donor really lists; quantity clamped to 1..60 and to what the donor has.
  select coalesce(jsonb_agg(jsonb_build_array(
           (d.it->>0)::int,
           least(greatest(w.qty, 1), 60, (d.it->>2)::int),
           (d.it->>3)::int,
           left(d.it->>9, 80),
           d.it->>6)), '[]'::jsonb)
    into v_items
    from (select (e->>0) as id, coalesce(e->>1, '0') as suffix,
                 case when (e->>2) ~ '^[0-9]{1,4}$' then (e->>2)::int else 1 end as qty
            from jsonb_array_elements(p_items) e
           where jsonb_typeof(e) = 'array') w
    join lateral (select it from jsonb_array_elements(v.items) it
                   where it->>0 = w.id and coalesce(it->>1, '0') = w.suffix limit 1) d on true;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'invalid_items';
  end if;

  -- Housekeeping and brakes: 60-day history, 200 rows per hour site-wide.
  delete from public.requests where created_at < now() - interval '60 days';
  if (select count(*) from public.requests where created_at > now() - interval '1 hour') >= 200 then
    raise exception 'too_many_requests';
  end if;

  -- The same player asking the same donor again within 10 minutes replaces the previous row.
  select id into v_id from public.requests
   where requester = v_name and donor = v.character and created_at > now() - interval '10 minutes'
   order by created_at desc limit 1;

  if v_id is not null then
    update public.requests
       set items = v_items, race = v_race, gender = v_gender, created_at = now()
     where id = v_id;
  else
    insert into public.requests (mask, requester, race, gender, donor, donor_race, donor_gender, items)
    values (v.mask, v_name, v_race, v_gender, v.character, v.race, v.gender, v_items);
  end if;

  return jsonb_build_object('logged', true);
end;
$$;

revoke all on function public.log_request(text, text, jsonb, text, text) from public;
grant execute on function public.log_request(text, text, jsonb, text, text) to anon, authenticated;

-- Tell the API layer about the new columns and functions right away.
notify pgrst, 'reload schema';

-- Moderation, from the SQL editor:
--   delete from public.requests where requester = 'Somename';
--   truncate public.requests;
