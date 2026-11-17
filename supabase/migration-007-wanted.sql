-- Iron Vault: migration 007. "Wanted": items a player is looking for and nobody offers yet.
-- Each want names a real item (its id, from a Wowhead link) for one challenge set. When a donor of that set
-- uploads the item, the site shows it as in stock. Wants close when the player cancels them, when they send a
-- request for that item, or after 30 days.
-- Run once in the Supabase SQL editor (Dashboard > SQL Editor > New query > Run). Safe to run again.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.wants (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  mask        smallint not null check (mask between 1 and 7),
  requester   text not null,
  race        text,
  gender      text,
  item_id     int not null check (item_id between 1 and 100000),
  name        text not null check (char_length(name) between 2 and 60),
  qty         smallint not null check (qty between 1 and 200),
  cancel_hash text not null
);
create index if not exists wants_mask_idx on public.wants (mask, created_at desc);

alter table public.wants enable row level security;
drop policy if exists "wants are public" on public.wants;
create policy "wants are public" on public.wants for select to anon, authenticated using (true);

revoke all on public.wants from anon, authenticated;
grant select (id, created_at, mask, requester, race, gender, item_id, name, qty) on public.wants to anon, authenticated;

-- Adds a want, or updates the quantity of the same player's open want for the same item and set.
-- Returns the id and a cancel token for the player's browser.
create or replace function public.add_want(
  p_requester text,
  p_mask      int,
  p_item      int,
  p_name      text,
  p_qty       int default 1,
  p_race      text default null,
  p_gender    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name   text := btrim(coalesce(p_requester, ''));
  v_item   text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_race   text := nullif(lower(regexp_replace(coalesce(p_race, ''), '[^A-Za-z]', '', 'g')), '');
  v_gender text := case lower(coalesce(p_gender, '')) when 'male' then 'male' when 'female' then 'female' else null end;
  v_token  text := encode(gen_random_bytes(16), 'hex');
  v_id     bigint;
begin
  if v_name !~ '^[A-Za-zÀ-ÿ]{2,12}$' then
    raise exception 'invalid_character';
  end if;
  v_name := upper(left(v_name, 1)) || lower(substr(v_name, 2));
  if p_mask is null or p_mask < 1 or p_mask > 7 then
    raise exception 'invalid_mask';
  end if;
  if p_item is null or p_item < 1 or p_item > 100000 then
    raise exception 'invalid_item';
  end if;
  -- Item names as Wowhead spells them: letters, digits and a little punctuation, nothing else.
  if v_item !~ '^[A-Za-z0-9][A-Za-z0-9 ''’:,.()-]{1,59}$' then
    raise exception 'invalid_item';
  end if;
  if v_race is not null and v_race not in ('human','dwarf','nightelf','gnome','draenei','orc','scourge','tauren','troll','bloodelf') then
    v_race := null;
  end if;

  delete from public.wants where created_at < now() - interval '30 days';

  select id into v_id from public.wants
   where lower(requester) = lower(v_name) and mask = p_mask and item_id = p_item
   limit 1;
  if v_id is not null then
    update public.wants
       set qty = least(greatest(coalesce(p_qty, 1), 1), 200), name = v_item, race = coalesce(v_race, race),
           gender = coalesce(v_gender, gender), created_at = now(),
           cancel_hash = encode(digest(v_token, 'sha256'), 'hex')
     where id = v_id;
    return jsonb_build_object('id', v_id, 'token', v_token, 'updated', true);
  end if;

  if (select count(*) from public.wants where lower(requester) = lower(v_name)) >= 10 then
    raise exception 'too_many_wants';
  end if;
  if (select count(*) from public.wants where created_at > now() - interval '1 hour') >= 100 then
    raise exception 'too_many_requests';
  end if;

  insert into public.wants (mask, requester, race, gender, item_id, name, qty, cancel_hash)
  values (p_mask, v_name, v_race, v_gender, p_item, v_item, least(greatest(coalesce(p_qty, 1), 1), 200),
          encode(digest(v_token, 'sha256'), 'hex'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'updated', false);
end;
$$;

-- Removes a want. Needs the token the player's browser received.
create or replace function public.cancel_want(p_id bigint, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select cancel_hash into v_hash from public.wants where id = p_id;
  if not found then
    raise exception 'request_not_found';
  end if;
  if v_hash <> encode(digest(lower(btrim(coalesce(p_token, ''))), 'sha256'), 'hex') then
    perform pg_sleep(1);
    raise exception 'wrong_code';
  end if;
  delete from public.wants where id = p_id;
  return jsonb_build_object('id', p_id, 'cancelled', true);
end;
$$;

revoke all on function public.add_want(text, int, int, text, int, text, text) from public;
revoke all on function public.cancel_want(bigint, text) from public;
grant execute on function public.add_want(text, int, int, text, int, text, text) to anon, authenticated;
grant execute on function public.cancel_want(bigint, text) to anon, authenticated;

-- Moderation, from the SQL editor:
--   delete from public.wants where requester = 'Somename';

notify pgrst, 'reload schema';
