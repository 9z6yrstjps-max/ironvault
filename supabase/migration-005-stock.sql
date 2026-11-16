-- Iron Vault: migration 005. Marking a request as delivered takes the items out of the donor's list;
-- undoing it puts them back. Run after migrations 003 and 004.
-- Run once in the Supabase SQL editor (Dashboard > SQL Editor > New query > Run). Safe to run again.

-- 1. What was actually taken from the donor's list when the request was marked as delivered:
--    array of [item as it was in the list, quantity taken]. Not readable from outside.
alter table public.requests add column if not exists deducted jsonb;
alter table public.requests add column if not exists cancel_hash text;

revoke all on public.requests from anon, authenticated;
grant select (id, created_at, mask, requester, race, gender, donor, donor_race, donor_gender, items, delivered_at)
  on public.requests to anon, authenticated;

-- 2. mark_request(): as before, plus the stock update.
--    The list's "updated" date is left alone: it still tells when the donor last exported from the game.
--    Undo puts the items back only if the donor has not uploaded a fresh export in the meantime.
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
  v       public.vaults%rowtype;
  r       public.requests%rowtype;
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_on    boolean := coalesce(p_delivered, true);
  v_items jsonb;
  v_ded   jsonb := '[]'::jsonb;
  e       jsonb;
  v_it    jsonb;
  v_idx   int;
  v_have  int;
  v_take  int;
begin
  select * into v from public.vaults where character_key = lower(btrim(coalesce(p_donor, ''))) for update;
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

  select * into r from public.requests where id = p_id and donor = v.character for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  v_items := v.items;

  if v_on and r.delivered_at is null then
    -- Request items are [itemId, quantity, quality, name, icon, suffixId]; older rows have no suffixId.
    for e in select * from jsonb_array_elements(r.items) loop
      v_idx := null;
      select (t.ord - 1)::int, t.it into v_idx, v_it
        from jsonb_array_elements(v_items) with ordinality as t(it, ord)
       where t.it->>0 = e->>0 and (e->>5 is null or coalesce(t.it->>1, '0') = e->>5)
       order by t.ord limit 1;
      if v_idx is not null then
        v_have := (v_it->>2)::int;
        v_take := least(greatest((e->>1)::int, 0), v_have);
        if v_have - v_take <= 0 then
          v_items := v_items - v_idx;
        else
          v_items := jsonb_set(v_items, array[v_idx::text, '2'], to_jsonb(v_have - v_take));
        end if;
        v_ded := v_ded || jsonb_build_array(jsonb_build_array(v_it, v_take));
      end if;
    end loop;
    update public.vaults set items = v_items where id = v.id;
    update public.requests set delivered_at = now(), deducted = v_ded where id = r.id;

  elsif not v_on and r.delivered_at is not null then
    if r.deducted is not null and v.updated_at <= r.delivered_at then
      for e in select * from jsonb_array_elements(r.deducted) loop
        v_it := e->0; v_take := (e->>1)::int; v_idx := null;
        select (t.ord - 1)::int, (t.it->>2)::int into v_idx, v_have
          from jsonb_array_elements(v_items) with ordinality as t(it, ord)
         where t.it->>0 = v_it->>0 and coalesce(t.it->>1, '0') = coalesce(v_it->>1, '0')
         order by t.ord limit 1;
        if v_idx is not null then
          v_items := jsonb_set(v_items, array[v_idx::text, '2'], to_jsonb(v_have + v_take));
        elsif v_take > 0 then
          v_items := v_items || jsonb_build_array(jsonb_set(v_it, '{2}', to_jsonb(v_take)));
        end if;
      end loop;
      update public.vaults set items = v_items where id = v.id;
    end if;
    update public.requests set delivered_at = null, deducted = null where id = r.id;
  end if;

  return jsonb_build_object('character', v.character, 'id', p_id, 'delivered', v_on);
end;
$$;

revoke all on function public.mark_request(text, text, bigint, boolean) from public;
grant execute on function public.mark_request(text, text, bigint, boolean) to anon, authenticated;

-- 3. log_request(): same as before, and each logged item now also carries its suffixId, so the
--    right variant ("of the Bear", "of the Eagle") is taken from the list.
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
           d.it->>6,
           coalesce(d.it->>1, '0'))), '[]'::jsonb)
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

-- Tell the API layer about the changes right away.
notify pgrst, 'reload schema';
