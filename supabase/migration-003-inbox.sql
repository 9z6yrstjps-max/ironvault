-- Iron Vault: migration 003. Lets a donor see the requests waiting for them and mark them as delivered.
-- Run once in the Supabase SQL editor (Dashboard > SQL Editor > New query > Run).
-- Safe to run again. It does not touch the lists or the requests already stored.

-- 1. When the donor marked the request as delivered (null = still waiting).
alter table public.requests add column if not exists delivered_at timestamptz;
create index if not exists requests_donor_idx on public.requests (donor, created_at desc);

revoke all on public.requests from anon, authenticated;
grant select on public.requests to anon, authenticated;

-- 2. Marks one request as delivered (or waiting again). Needs the donor's vault code.
--    With p_id null it only checks the code, so a donor can sign in from another browser.
create or replace function public.mark_request(
  p_donor     text,
  p_code      text,
  p_id        bigint default null,
  p_delivered boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v      public.vaults%rowtype;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_when timestamptz := case when coalesce(p_delivered, true) then now() else null end;
begin
  select * into v from public.vaults where character_key = lower(btrim(coalesce(p_donor, '')));
  if not found then
    raise exception 'not_found';
  end if;
  if v_code = '' or v.code_hash <> crypt(v_code, v.code_hash) then
    perform pg_sleep(1);            -- slows down code guessing
    raise exception 'wrong_code';
  end if;
  if p_id is null then
    return jsonb_build_object('character', v.character, 'ok', true);
  end if;

  update public.requests set delivered_at = v_when where id = p_id and donor = v.character;
  if not found then
    raise exception 'request_not_found';
  end if;
  return jsonb_build_object('character', v.character, 'id', p_id, 'delivered', v_when is not null);
end;
$$;

revoke all on function public.mark_request(text, text, bigint, boolean) from public;
grant execute on function public.mark_request(text, text, bigint, boolean) to anon, authenticated;

-- 3. log_request(): same as before, except that a request already delivered is not overwritten
--    when the same player asks the same donor again within 10 minutes.
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
     and delivered_at is null          -- a request already delivered is never overwritten
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

-- Tell the API layer about the new column and function right away.
notify pgrst, 'reload schema';
