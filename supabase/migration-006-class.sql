-- Iron Vault: migration 006. Class and level of each donor character, sent by addon 0.5 and shown
-- with an icon next to the name. Independent of migrations 003 to 005.
-- Run once in the Supabase SQL editor (Dashboard > SQL Editor > New query > Run). Safe to run again.

alter table public.vaults add column if not exists class text
  check (class is null or class in ('warrior','paladin','hunter','rogue','priest','deathknight','shaman','mage','warlock','druid'));
alter table public.vaults add column if not exists level smallint check (level is null or level between 1 and 80);

revoke all on public.vaults from anon, authenticated;
grant select (id, character, mask, note, items, updated_at, race, gender, class, level) on public.vaults to anon, authenticated;

-- upload_vault() gains p_class and p_level. The seven-argument version is replaced.
drop function if exists public.upload_vault(text, int, jsonb, text, text, text, text);

create or replace function public.upload_vault(
  p_character text,
  p_mask      int,
  p_items     jsonb,
  p_code      text default null,
  p_note      text default '',
  p_race      text default null,
  p_gender    text default null,
  p_class     text default null,
  p_level     int default null
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
  v_class  text := nullif(lower(regexp_replace(coalesce(p_class, ''), '[^A-Za-z]', '', 'g')), '');
  v_level  int := case when p_level between 1 and 80 then p_level else null end;
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

  if v_class is not null and v_class not in ('warrior','paladin','hunter','rogue','priest','deathknight','shaman','mage','warlock','druid') then
    v_class := null;
  end if;

  select * into v from public.vaults where character_key = lower(v_name);

  if found then
    if v_code = '' or v.code_hash <> crypt(v_code, v.code_hash) then
      perform pg_sleep(1);            -- slows down code guessing
      raise exception 'wrong_code';
    end if;
    update public.vaults
       set mask = p_mask, note = v_note, items = p_items, updated_at = now(),
           race = coalesce(v_race, race), gender = coalesce(v_gender, gender),
           class = coalesce(v_class, class), level = coalesce(v_level, level)
     where id = v.id;
    return jsonb_build_object('character', v_name, 'code', null, 'count', jsonb_array_length(p_items));
  end if;

  -- Brake on mass registration: at most 40 new vaults per hour, site-wide.
  if (select count(*) from public.vaults where created_at > now() - interval '1 hour') >= 40 then
    raise exception 'too_many_new_vaults';
  end if;

  v_new := upper(encode(gen_random_bytes(6), 'hex'));
  v_new := substr(v_new, 1, 4) || '-' || substr(v_new, 5, 4) || '-' || substr(v_new, 9, 4);

  insert into public.vaults (character, mask, note, items, code_hash, race, gender, class, level)
  values (v_name, p_mask, v_note, p_items, crypt(v_new, gen_salt('bf', 8)), v_race, v_gender, v_class, v_level);

  return jsonb_build_object('character', v_name, 'code', v_new, 'count', jsonb_array_length(p_items));
end;
$$;

revoke all on function public.upload_vault(text, int, jsonb, text, text, text, text, text, int) from public;
grant execute on function public.upload_vault(text, int, jsonb, text, text, text, text, text, int) to anon, authenticated;

-- Tell the API layer about the new columns and function right away.
notify pgrst, 'reload schema';
