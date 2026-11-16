-- Iron Vault: migration 004. Lets a request be cancelled: by the player who made it (from the same
-- browser) or by the donor it was addressed to (with the vault code).
-- Run once in the Supabase SQL editor (Dashboard > SQL Editor > New query > Run).
-- Safe to run again. Requests made before this migration can only be removed by the donor.

-- 1. Hash of the cancel token handed to the requester's browser. Never readable from outside.
alter table public.requests add column if not exists cancel_hash text;

revoke all on public.requests from anon, authenticated;
grant select (id, created_at, mask, requester, race, gender, donor, donor_race, donor_gender, items, delivered_at)
  on public.requests to anon, authenticated;

-- 2. Removes one request. Either the requester's token or the donor's name and vault code.
--    The requester cannot remove a request the donor already marked as delivered.
create or replace function public.cancel_request(
  p_id    bigint,
  p_token text default null,
  p_donor text default null,
  p_code  text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r       public.requests%rowtype;
  v       public.vaults%rowtype;
  v_token text := lower(btrim(coalesce(p_token, '')));
  v_code  text := upper(btrim(coalesce(p_code, '')));
begin
  select * into r from public.requests where id = p_id;
  if not found then
    raise exception 'request_not_found';
  end if;

  if v_token <> '' then
    if r.cancel_hash is null or r.cancel_hash <> encode(digest(v_token, 'sha256'), 'hex') then
      perform pg_sleep(1);
      raise exception 'wrong_code';
    end if;
    if r.delivered_at is not null then
      raise exception 'already_delivered';
    end if;
  else
    select * into v from public.vaults where character_key = lower(btrim(coalesce(p_donor, '')));
    if not found or v.character <> r.donor then
      raise exception 'request_not_found';
    end if;
    if v_code = '' or v.code_hash <> crypt(v_code, v.code_hash) then
      perform pg_sleep(1);            -- slows down code guessing
      raise exception 'wrong_code';
    end if;
  end if;

  delete from public.requests where id = r.id;
  return jsonb_build_object('id', r.id, 'cancelled', true);
end;
$$;

revoke all on function public.cancel_request(bigint, text, text, text) from public;
grant execute on function public.cancel_request(bigint, text, text, text) to anon, authenticated;

-- 3. log_request(): same as before, and now returns the request id with a one-off cancel token.
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
  v_token  text := encode(gen_random_bytes(16), 'hex');
  v_hash   text := encode(digest(v_token, 'sha256'), 'hex');
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
       set items = v_items, race = v_race, gender = v_gender, created_at = now(), cancel_hash = v_hash
     where id = v_id;
  else
    insert into public.requests (mask, requester, race, gender, donor, donor_race, donor_gender, items, cancel_hash)
    values (v.mask, v_name, v_race, v_gender, v.character, v.race, v.gender, v_items, v_hash)
    returning id into v_id;
  end if;

  return jsonb_build_object('logged', true, 'id', v_id, 'token', v_token);
end;
$$;

revoke all on function public.log_request(text, text, jsonb, text, text) from public;
grant execute on function public.log_request(text, text, jsonb, text, text) to anon, authenticated;

-- Tell the API layer about the new function right away.
notify pgrst, 'reload schema';
