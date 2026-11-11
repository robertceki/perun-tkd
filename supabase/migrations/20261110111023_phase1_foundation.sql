-- Additive phase-one foundation. Review before applying to the authorized development project.
create schema if not exists tkd_private;
revoke all on schema tkd_private from public, anon, authenticated;
grant usage on schema tkd_private to authenticated;
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
set search_path = public, extensions, pg_catalog;

create table public.trainers (
  id uuid primary key,
  user_id uuid not null unique references auth.users(id),
  full_name text not null check (btrim(full_name) <> ''),
  active boolean not null default true
);
create table public.groups (
  id uuid primary key,
  name text not null check (btrim(name) <> ''),
  kind text not null check (kind in ('main','competition')),
  active boolean not null default true
);
create table public.contacts (
  id uuid primary key,
  first_name text not null check (btrim(first_name) <> ''),
  last_name text not null check (btrim(last_name) <> ''),
  phone text not null check (btrim(phone) <> ''),
  email text check (email is null or btrim(email) = '' or btrim(email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  address text
);
create table public.children (
  id uuid primary key,
  first_name text not null check (btrim(first_name) <> ''),
  last_name text not null check (btrim(last_name) <> ''),
  birth_date date not null check (isfinite(birth_date) and birth_date >= date '0001-01-01' and birth_date <= current_date),
  address text not null default '',
  belt text not null default '',
  status text not null check (status in ('active','inactive')),
  main_group_id uuid not null references public.groups(id),
  competition_group_id uuid references public.groups(id),
  check (main_group_id is distinct from competition_group_id)
);
create index children_main_group_idx on public.children(main_group_id);
create index children_competition_group_idx on public.children(competition_group_id);
create table public.child_contacts (
  child_id uuid not null references public.children(id),
  contact_id uuid not null references public.contacts(id),
  relationship text not null check (btrim(relationship) <> ''),
  is_primary boolean not null default false,
  primary key (child_id,contact_id)
);
create unique index child_one_primary_idx on public.child_contacts(child_id) where is_primary;
create index child_contacts_contact_idx on public.child_contacts(contact_id);
create table public.weekly_terms (
  id uuid primary key,
  group_id uuid not null references public.groups(id),
  weekday integer not null check (weekday between 1 and 7),
  starts_at time not null,
  ends_at time not null,
  trainer_id uuid not null references public.trainers(id),
  valid_from date not null check (isfinite(valid_from) and valid_from >= date '0001-01-01'),
  valid_to date check (valid_to is null or (isfinite(valid_to) and valid_to >= valid_from)),
  active boolean not null default true,
  check (starts_at < ends_at and ends_at < time '24:00:00')
);
create index weekly_terms_group_idx on public.weekly_terms(group_id);
create index weekly_terms_trainer_idx on public.weekly_terms(trainer_id);
create table public.term_assignments (
  term_id uuid not null references public.weekly_terms(id),
  child_id uuid not null references public.children(id),
  valid_from date not null check (isfinite(valid_from) and valid_from >= date '0001-01-01'),
  valid_to date check (valid_to is null or (isfinite(valid_to) and valid_to >= valid_from)),
  primary key (term_id,child_id,valid_from),
  exclude using gist (term_id with =, child_id with =, daterange(valid_from,valid_to,'[]') with &&)
);
create index term_assignments_child_idx on public.term_assignments(child_id);

-- The only definer helper: no parameters, no user_metadata, only the current auth.uid().
-- Its owner reads trainer membership without entering the trainers SELECT policy recursively.
create function tkd_private.is_active_trainer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.trainers where user_id = (select auth.uid()) and active);
$$;
revoke all on function tkd_private.is_active_trainer() from public, anon, authenticated;
grant execute on function tkd_private.is_active_trainer() to authenticated;

alter table public.trainers enable row level security;
alter table public.groups enable row level security;
alter table public.contacts enable row level security;
alter table public.children enable row level security;
alter table public.child_contacts enable row level security;
alter table public.weekly_terms enable row level security;
alter table public.term_assignments enable row level security;
revoke all on public.trainers, public.groups, public.contacts, public.children, public.child_contacts, public.weekly_terms, public.term_assignments from public, anon, authenticated;
grant select on public.trainers to authenticated;
grant select, insert, update on public.groups, public.contacts, public.children, public.weekly_terms, public.term_assignments to authenticated;
grant select, insert, update, delete on public.child_contacts to authenticated;
create policy trainer_read on public.trainers for select to authenticated using ((select tkd_private.is_active_trainer()));
create policy trainer_domain on public.groups for all to authenticated using ((select tkd_private.is_active_trainer())) with check ((select tkd_private.is_active_trainer()));
create policy trainer_domain on public.contacts for all to authenticated using ((select tkd_private.is_active_trainer())) with check ((select tkd_private.is_active_trainer()));
create policy trainer_domain on public.children for all to authenticated using ((select tkd_private.is_active_trainer())) with check ((select tkd_private.is_active_trainer()));
create policy trainer_domain on public.child_contacts for all to authenticated using ((select tkd_private.is_active_trainer())) with check ((select tkd_private.is_active_trainer()));
create policy trainer_domain on public.weekly_terms for all to authenticated using ((select tkd_private.is_active_trainer())) with check ((select tkd_private.is_active_trainer()));
create policy trainer_domain on public.term_assignments for all to authenticated using ((select tkd_private.is_active_trainer())) with check ((select tkd_private.is_active_trainer()));

create function tkd_private.check_child() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare g public.groups;
begin
  select * into g from public.groups where id = new.main_group_id for share;
  if not found or g.kind <> 'main' then raise exception 'Glavna grupa nije ispravna.'; end if;
  if not g.active and (tg_op = 'INSERT' or new.main_group_id is distinct from old.main_group_id) then raise exception 'Glavna grupa nije aktivna.'; end if;
  if new.competition_group_id is not null then
    select * into g from public.groups where id = new.competition_group_id for share;
    if not found or g.kind <> 'competition' then raise exception 'Takmičarska grupa nije ispravna.'; end if;
    if not g.active and (tg_op = 'INSERT' or new.competition_group_id is distinct from old.competition_group_id) then raise exception 'Takmičarska grupa nije aktivna.'; end if;
  end if;
  if tg_op = 'UPDATE' and exists (
    select 1 from public.term_assignments a join public.weekly_terms t on t.id = a.term_id
    where a.child_id = new.id and (a.valid_to is null or a.valid_to >= current_date)
    and (new.status <> 'active' or (t.group_id <> new.main_group_id and t.group_id is distinct from new.competition_group_id))
  ) then raise exception 'Najpre završite postojeće upise deteta.'; end if;
  return new;
end;
$$;
create trigger check_child before insert or update on public.children for each row execute function tkd_private.check_child();

create function tkd_private.check_primary_contact() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare target uuid;
begin
  -- Check both parents if a direct UPDATE moves a link.
  if tg_table_name = 'children' then target := new.id;
  elsif tg_op = 'DELETE' then target := old.child_id;
  else target := new.child_id;
  end if;
  perform 1 from public.children where id = target for update;
  if found and (select count(*) from public.child_contacts where child_id = target and is_primary) <> 1 then
    raise exception 'Dete mora imati tačno jedan glavni kontakt.';
  end if;
  if tg_table_name = 'child_contacts' then
    if tg_op = 'UPDATE' then
      if old.child_id <> new.child_id then
        perform 1 from public.children where id = old.child_id for update;
        if found and (select count(*) from public.child_contacts where child_id = old.child_id and is_primary) <> 1 then
          raise exception 'Dete mora imati tačno jedan glavni kontakt.';
        end if;
      end if;
    end if;
  end if;
  return null;
end;
$$;
create constraint trigger child_primary after insert or update on public.children deferrable initially deferred for each row execute function tkd_private.check_primary_contact();
create constraint trigger link_primary after insert or update or delete on public.child_contacts deferrable initially deferred for each row execute function tkd_private.check_primary_contact();

create function tkd_private.check_group_kind() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.kind <> old.kind and (exists(select 1 from public.children where main_group_id = old.id or competition_group_id = old.id) or exists(select 1 from public.weekly_terms where group_id = old.id)) then
    raise exception 'Vrsta povezane grupe se ne može menjati.';
  end if;
  return new;
end;
$$;
create trigger check_group_kind before update on public.groups for each row execute function tkd_private.check_group_kind();

create function tkd_private.check_term() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.group_id is distinct from old.group_id then
    perform 1 from public.groups where id = new.group_id and active for share;
    if not found then raise exception 'Grupa termina mora biti aktivna.'; end if;
  end if;
  if tg_op = 'INSERT' or new.trainer_id is distinct from old.trainer_id then
    perform 1 from public.trainers where id = new.trainer_id and active;
    if not found then raise exception 'Trener termina mora biti aktivan.'; end if;
  end if;
  if tg_op = 'UPDATE' then
    if exists(select 1 from public.term_assignments where term_id = old.id) and
      (new.group_id,new.weekday,new.starts_at,new.ends_at,new.trainer_id,new.valid_from) is distinct from
      (old.group_id,old.weekday,old.starts_at,old.ends_at,old.trainer_id,old.valid_from) then
      raise exception 'Za promenu povezanog rasporeda napravite novi termin.';
    end if;
    if exists(select 1 from public.term_assignments where term_id = old.id and
      (valid_from < new.valid_from or (new.valid_to is not null and (valid_to is null or valid_to > new.valid_to)))) then
      raise exception 'Period termina mora obuhvatiti sve postojeće upise.';
    end if;
  end if;
  return new;
end;
$$;
create trigger check_term before insert or update on public.weekly_terms for each row execute function tkd_private.check_term();

create function tkd_private.check_assignment() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare t public.weekly_terms; c public.children; closing boolean := false;
begin
  if tg_op = 'UPDATE' then
    if (new.term_id,new.child_id,new.valid_from) is distinct from (old.term_id,old.child_id,old.valid_from) then raise exception 'Identitet upisa se ne može menjati.'; end if;
    if old.valid_to < current_date and new is distinct from old then raise exception 'Završeni upis se ne može menjati.'; end if;
    closing := new.valid_to is not null and (old.valid_to is null or new.valid_to <= old.valid_to);
  end if;
  select * into t from public.weekly_terms where id = new.term_id for update;
  if not found then raise exception 'Termin ne postoji.'; end if;
  select * into c from public.children where id = new.child_id for update;
  if not found then raise exception 'Dete ne postoji.'; end if;
  if new.valid_from < t.valid_from or (t.valid_to is not null and (new.valid_to is null or new.valid_to > t.valid_to)) then raise exception 'Upis mora biti u periodu termina.'; end if;
  -- Unchanged ended rows and explicit closures remain valid after later deactivation/group changes.
  if not (tg_op = 'UPDATE' and (new is not distinct from old or closing)) then
    if not t.active or c.status <> 'active' or (t.group_id <> c.main_group_id and t.group_id is distinct from c.competition_group_id) then raise exception 'Dete nije podobno za ovaj termin.'; end if;
    perform 1 from public.groups where id = t.group_id and active;
    if not found then raise exception 'Grupa termina nije aktivna.'; end if;
    perform 1 from public.trainers where id = t.trainer_id and active;
    if not found then raise exception 'Trener termina nije aktivan.'; end if;
  end if;
  return new;
end;
$$;
create trigger check_assignment before insert or update on public.term_assignments for each row execute function tkd_private.check_assignment();

-- Atomic aggregates. Contacts are shared independent records; p_contacts contains links only.
create function public.save_child(p_child jsonb, p_contacts jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare c public.children; link public.child_contacts;
begin
  if not tkd_private.is_active_trainer() then raise exception 'Pristup nije dozvoljen.'; end if;
  if jsonb_typeof(p_child) is distinct from 'object' or jsonb_typeof(p_contacts) is distinct from 'array' then raise exception 'Neispravan zahtev.'; end if;
  c := jsonb_populate_record(null::public.children,p_child);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.id::text,0));
  update public.children set first_name=btrim(c.first_name),last_name=btrim(c.last_name),birth_date=c.birth_date,address=c.address,belt=c.belt,status=c.status,main_group_id=c.main_group_id,competition_group_id=c.competition_group_id where id=c.id;
  if not found then
    insert into public.children values (c.id,btrim(c.first_name),btrim(c.last_name),c.birth_date,c.address,c.belt,c.status,c.main_group_id,c.competition_group_id);
  end if;
  -- Parent row lock serializes concurrent edits; deferred constraint validates final contacts.
  perform 1 from public.children where id=c.id for update;
  delete from public.child_contacts where child_id=c.id;
  for link in select * from jsonb_populate_recordset(null::public.child_contacts,p_contacts) loop
    if link.child_id is distinct from c.id then raise exception 'Kontakt pripada drugom detetu.'; end if;
    insert into public.child_contacts values(link.child_id,link.contact_id,btrim(link.relationship),link.is_primary);
  end loop;
  if (select count(*) from public.child_contacts where child_id=c.id and is_primary) <> 1 then raise exception 'Dete mora imati tačno jedan glavni kontakt.'; end if;
end;
$$;

create function public.save_term(p_term jsonb, p_assignments jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare t public.weekly_terms; a public.term_assignments;
begin
  if not tkd_private.is_active_trainer() then raise exception 'Pristup nije dozvoljen.'; end if;
  if jsonb_typeof(p_term) is distinct from 'object' or jsonb_typeof(p_assignments) is distinct from 'array' then raise exception 'Neispravan zahtev.'; end if;
  t := jsonb_populate_record(null::public.weekly_terms,p_term);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(t.id::text,1));
  -- Close/update existing ranges before narrowing the term, but validate all final state atomically.
  perform 1 from public.weekly_terms where id=t.id for update;
  if exists(select 1 from public.weekly_terms where id=t.id) then
    for a in select * from jsonb_populate_recordset(null::public.term_assignments,p_assignments) loop
      if a.term_id is distinct from t.id then raise exception 'Upis pripada drugom terminu.'; end if;
      update public.term_assignments set valid_to=a.valid_to where term_id=a.term_id and child_id=a.child_id and valid_from=a.valid_from;
    end loop;
  end if;
  update public.weekly_terms set group_id=t.group_id,weekday=t.weekday,starts_at=t.starts_at,ends_at=t.ends_at,trainer_id=t.trainer_id,valid_from=t.valid_from,valid_to=t.valid_to,active=t.active where id=t.id;
  if not found then
    insert into public.weekly_terms values(t.id,t.group_id,t.weekday,t.starts_at,t.ends_at,t.trainer_id,t.valid_from,t.valid_to,t.active);
  end if;
  if exists(select 1 from jsonb_populate_recordset(null::public.term_assignments,p_assignments) x group by x.term_id,x.child_id,x.valid_from having count(*) > 1) then raise exception 'Dupliran upis.'; end if;
  for a in select * from jsonb_populate_recordset(null::public.term_assignments,p_assignments) loop
    if a.term_id is distinct from t.id then raise exception 'Upis pripada drugom terminu.'; end if;
    update public.term_assignments set valid_to=a.valid_to where term_id=a.term_id and child_id=a.child_id and valid_from=a.valid_from;
    if not found then
      insert into public.term_assignments values(a.term_id,a.child_id,a.valid_from,a.valid_to);
    end if;
  end loop;
  -- Omitted rows are deliberately retained, including ended history. No implicit DELETE.
end;
$$;

revoke all on function tkd_private.check_child(), tkd_private.check_primary_contact(), tkd_private.check_group_kind(), tkd_private.check_term(), tkd_private.check_assignment() from public, anon, authenticated;
revoke all on function public.save_child(jsonb,jsonb), public.save_term(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_child(jsonb,jsonb), public.save_term(jsonb,jsonb) to authenticated;
reset search_path;
