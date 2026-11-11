-- APP-S2 additive migration. Parent review/application only; D1 is unchanged.
set search_path = public, extensions, pg_catalog;
alter table public.weekly_terms
  add column created_by uuid references public.trainers(id),
  add column updated_by uuid references public.trainers(id),
  add column created_at timestamptz,
  add column updated_at timestamptz;
-- No fabricated legacy creator/time backfill.
alter table public.term_assignments add column cancelled_at timestamptz;
-- Replace only the overlap constraint: live enrollment still has full exclusion.
do $$ declare n text; begin
  for n in select conname from pg_constraint where conrelid='public.term_assignments'::regclass and contype='x' loop
    execute format('alter table public.term_assignments drop constraint %I',n);
  end loop;
end $$;
alter table public.term_assignments add constraint live_assignment_no_overlap
  exclude using gist (term_id with =, child_id with =, daterange(valid_from,valid_to,'[]') with &&)
  where (cancelled_at is null);

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.weekly_terms(id),
  session_date date not null check (isfinite(session_date) and session_date >= date '0001-01-01'),
  group_id uuid not null references public.groups(id),
  group_name text not null,
  starts_at time not null,
  ends_at time not null,
  starts_at_utc timestamptz not null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null references public.trainers(id),
  updated_by uuid not null references public.trainers(id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique(term_id,session_date)
);
create table public.session_attendance (
  session_id uuid not null references public.training_sessions(id),
  child_id uuid not null references public.children(id),
  child_first_name text not null,
  child_last_name text not null,
  present boolean not null default false,
  is_substitute boolean not null default false,
  created_by uuid not null references public.trainers(id),
  updated_by uuid not null references public.trainers(id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key(session_id,child_id)
);
create index session_attendance_child_idx on public.session_attendance(child_id);
alter table public.training_sessions enable row level security;
alter table public.session_attendance enable row level security;
revoke all on public.training_sessions, public.session_attendance from public, anon, authenticated;
grant select, insert, update on public.training_sessions, public.session_attendance to authenticated;
create policy trainer_domain on public.training_sessions for all to authenticated
  using ((select tkd_private.is_active_trainer())) with check ((select tkd_private.is_active_trainer()));
create policy trainer_domain on public.session_attendance for all to authenticated
  using ((select tkd_private.is_active_trainer())) with check ((select tkd_private.is_active_trainer()));

-- Private append-only audit, no client read/write grants or exposed write API.
create table tkd_private.attendance_audit (
  id bigint generated always as identity primary key,
  entity text not null,
  operation text not null,
  actor_id uuid not null references public.trainers(id),
  happened_at timestamptz not null,
  before_row jsonb,
  after_row jsonb
);
alter table tkd_private.attendance_audit enable row level security;
revoke all on tkd_private.attendance_audit from public, anon, authenticated;
revoke all on sequence tkd_private.attendance_audit_id_seq from public, anon, authenticated;

-- Invoker lookup uses the existing nonrecursive, owner-controlled membership policy.
create function tkd_private.current_trainer() returns uuid
language plpgsql stable security invoker set search_path = '' as $$
declare actor uuid;
begin
  select id into actor from public.trainers where user_id=auth.uid() and active;
  if actor is null then raise exception 'Pristup je dozvoljen samo aktivnim trenerima.'; end if;
  return actor;
end $$;
-- One club: serialize relevant writes BEFORE row locks (statement triggers), including REST.
-- This intentionally favors correctness over write throughput for the small shared club.
create function tkd_private.attendance_lock() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform tkd_private.current_trainer();
  perform pg_catalog.pg_advisory_xact_lock(781124,2);
end $$;
create function tkd_private.lock_attendance_write() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin perform tkd_private.attendance_lock(); return null; end $$;
do $$ declare n text; begin
  foreach n in array array['weekly_terms','term_assignments','children','groups','training_sessions','session_attendance'] loop
    execute format('create trigger a00_attendance_lock before insert or update or delete on public.%I for each statement execute function tkd_private.lock_attendance_write()',n);
  end loop;
end $$;

create function tkd_private.term_metadata() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare actor uuid := tkd_private.current_trainer();
begin
  if tg_op='INSERT' then
    new.created_by:=actor; new.created_at:=clock_timestamp();
    new.trainer_id:=coalesce(new.trainer_id,actor);
  else
    new.created_by:=old.created_by; new.created_at:=old.created_at;
    if new.id is distinct from old.id then raise exception 'Identitet termina je nepromenljiv.'; end if;
  end if;
  new.updated_by:=actor; new.updated_at:=clock_timestamp();
  if (tg_op='INSERT' or new.starts_at is distinct from old.starts_at) and extract(second from new.starts_at)<>0 then
    raise exception 'Novi unos početka mora imati nula sekundi.';
  end if;
  if (tg_op='INSERT' or new.ends_at is distinct from old.ends_at) and extract(second from new.ends_at)<>0 then
    raise exception 'Novi unos kraja mora imati nula sekundi.';
  end if;
  return new;
end $$;
-- Alphabetically before existing check_term, including INSERT trainer default.
create trigger a01_term_metadata before insert or update on public.weekly_terms
  for each row execute function tkd_private.term_metadata();

alter table public.children drop constraint children_birth_date_check;
alter table public.children add constraint children_birth_date_check
  check (isfinite(birth_date) and birth_date >= date '0001-01-01');
create or replace function tkd_private.check_child() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare g public.groups;
begin
  if new.birth_date > (clock_timestamp() at time zone 'Europe/Belgrade')::date then
    raise exception 'Datum rođenja ne može biti u budućnosti.';
  end if;
  select * into g from public.groups where id=new.main_group_id for share;
  if not found or g.kind<>'main' then raise exception 'Glavna grupa nije ispravna.'; end if;
  if not g.active and (tg_op='INSERT' or new.main_group_id is distinct from old.main_group_id) then raise exception 'Glavna grupa nije aktivna.'; end if;
  if new.competition_group_id is not null then
    select * into g from public.groups where id=new.competition_group_id for share;
    if not found or g.kind<>'competition' then raise exception 'Takmičarska grupa nije ispravna.'; end if;
    if not g.active and (tg_op='INSERT' or new.competition_group_id is distinct from old.competition_group_id) then raise exception 'Takmičarska grupa nije aktivna.'; end if;
  end if;
  if tg_op='UPDATE' and exists (
    select 1 from public.term_assignments a join public.weekly_terms t on t.id=a.term_id
    where a.child_id=new.id and a.cancelled_at is null
      and (a.valid_to is null or a.valid_to >= (clock_timestamp() at time zone 'Europe/Belgrade')::date)
      and (new.status<>'active' or (t.group_id<>new.main_group_id and t.group_id is distinct from new.competition_group_id))
  ) then raise exception 'Najpre završite postojeće upise deteta.'; end if;
  return new;
end $$;

create or replace function tkd_private.check_assignment() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare t public.weekly_terms; c public.children; closing boolean := false;
begin
  if tg_op='UPDATE' then
    if (new.term_id,new.child_id,new.valid_from) is distinct from (old.term_id,old.child_id,old.valid_from) then raise exception 'Identitet upisa se ne može menjati.'; end if;
    if old.cancelled_at is not null then
      if new is distinct from old then raise exception 'Otkazani upis je nepromenljiv; napravite novi upis.'; end if;
      return new;
    end if;
    if new.cancelled_at is not null then
      if new.valid_to is distinct from old.valid_to then raise exception 'Otkazivanje ne menja period upisa.'; end if;
      new.cancelled_at:=clock_timestamp();
      return new;
    end if;
    if old.valid_to < (clock_timestamp() at time zone 'Europe/Belgrade')::date and new is distinct from old then raise exception 'Završeni upis se ne može menjati.'; end if;
    closing:=new.valid_to is not null and (old.valid_to is null or new.valid_to<=old.valid_to);
  else
    if new.cancelled_at is not null then raise exception 'Novi upis ne može sadržati otkazivanje.'; end if;
    -- Explicit re-enrollment starts on a later local date, never resurrects cancelled identity/history.
    if exists(select 1 from public.term_assignments a where a.term_id=new.term_id and a.child_id=new.child_id
      and a.cancelled_at is not null and new.valid_from <= (a.cancelled_at at time zone 'Europe/Belgrade')::date)
    then raise exception 'Ponovni upis mora početi posle datuma otkazivanja.'; end if;
  end if;
  select * into t from public.weekly_terms where id=new.term_id for update;
  if not found then raise exception 'Termin ne postoji.'; end if;
  select * into c from public.children where id=new.child_id for update;
  if not found then raise exception 'Dete ne postoji.'; end if;
  if new.valid_from<t.valid_from or (t.valid_to is not null and (new.valid_to is null or new.valid_to>t.valid_to)) then raise exception 'Upis mora biti u periodu termina.'; end if;
  if not (tg_op='UPDATE' and (new is not distinct from old or closing)) then
    if not t.active or c.status<>'active' or (t.group_id<>c.main_group_id and t.group_id is distinct from c.competition_group_id) then raise exception 'Dete nije podobno za ovaj termin.'; end if;
    perform 1 from public.groups where id=t.group_id and active;
    if not found then raise exception 'Grupa termina nije aktivna.'; end if;
    perform 1 from public.trainers where id=t.trainer_id and active;
    if not found then raise exception 'Trener termina nije aktivan.'; end if;
  end if;
  return new;
end $$;

-- Same signature, explicit column lists survive additive columns. Omitted/cancelled history retained.
create or replace function public.save_term(p_term jsonb, p_assignments jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare t public.weekly_terms; a public.term_assignments;
begin
  perform tkd_private.attendance_lock();
  if jsonb_typeof(p_term) is distinct from 'object' or jsonb_typeof(p_assignments) is distinct from 'array' then raise exception 'Neispravan zahtev.'; end if;
  t:=jsonb_populate_record(null::public.weekly_terms,p_term);
  -- Reject fractional textual NEW inputs too, even .0 which a time cast would erase.
  if not exists(select 1 from public.weekly_terms where id=t.id and starts_at=t.starts_at)
    and coalesce(p_term->>'starts_at','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$' then
    raise exception 'Novi unos početka mora biti HH:mm ili HH:mm:00.';
  end if;
  if not exists(select 1 from public.weekly_terms where id=t.id and ends_at=t.ends_at)
    and coalesce(p_term->>'ends_at','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:00)?$' then
    raise exception 'Novi unos kraja mora biti HH:mm ili HH:mm:00.';
  end if;
  perform 1 from public.weekly_terms where id=t.id for update;
  if exists(select 1 from public.weekly_terms where id=t.id) then
    for a in select * from jsonb_populate_recordset(null::public.term_assignments,p_assignments) loop
      if a.term_id is distinct from t.id then raise exception 'Upis pripada drugom terminu.'; end if;
      update public.term_assignments set valid_to=a.valid_to where term_id=a.term_id and child_id=a.child_id and valid_from=a.valid_from and cancelled_at is null;
    end loop;
  end if;
  update public.weekly_terms set group_id=t.group_id,weekday=t.weekday,starts_at=t.starts_at,ends_at=t.ends_at,
    trainer_id=coalesce(t.trainer_id,trainer_id),valid_from=t.valid_from,valid_to=t.valid_to,active=t.active where id=t.id;
  if not found then
    insert into public.weekly_terms(id,group_id,weekday,starts_at,ends_at,trainer_id,valid_from,valid_to,active)
      values(t.id,t.group_id,t.weekday,t.starts_at,t.ends_at,t.trainer_id,t.valid_from,t.valid_to,t.active);
  end if;
  if exists(select 1 from jsonb_populate_recordset(null::public.term_assignments,p_assignments) x group by x.term_id,x.child_id,x.valid_from having count(*)>1) then raise exception 'Dupliran upis.'; end if;
  for a in select * from jsonb_populate_recordset(null::public.term_assignments,p_assignments) loop
    if a.term_id is distinct from t.id then raise exception 'Upis pripada drugom terminu.'; end if;
    if exists(select 1 from public.term_assignments where term_id=a.term_id and child_id=a.child_id and valid_from=a.valid_from and cancelled_at is not null) then continue; end if;
    if a.cancelled_at is not null then raise exception 'Koristite cancel_enrollment za otkazivanje.'; end if;
    update public.term_assignments set valid_to=a.valid_to where term_id=a.term_id and child_id=a.child_id and valid_from=a.valid_from;
    if not found then
      insert into public.term_assignments(term_id,child_id,valid_from,valid_to) values(a.term_id,a.child_id,a.valid_from,a.valid_to);
    end if;
  end loop;
end $$;

create function tkd_private.check_session() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare t public.weekly_terms; actor uuid:=tkd_private.current_trainer();
begin
  if tg_op='INSERT' then
    select * into t from public.weekly_terms where id=new.term_id for update;
    if not found then raise exception 'Termin ne postoji.'; end if;
    if not isfinite(new.session_date) or new.session_date<t.valid_from or (t.valid_to is not null and new.session_date>t.valid_to)
      or extract(isodow from new.session_date)<>t.weekday then raise exception 'Datum nije u rasporedu termina.'; end if;
    -- Inactive current entities must not erase historical assignment eligibility.
    new.id:=gen_random_uuid();
    new.group_id:=t.group_id;
    select name into strict new.group_name from public.groups where id=t.group_id;
    new.starts_at:=t.starts_at; new.ends_at:=t.ends_at;
    new.starts_at_utc:=(new.session_date+t.starts_at) at time zone 'Europe/Belgrade';  
    if clock_timestamp()<new.starts_at_utc then raise exception 'Trening još nije počeo.'; end if;
    new.completed_at:=null; new.cancelled_at:=null;
    new.created_by:=actor; new.created_at:=clock_timestamp();
  else
    if (to_jsonb(new)-array['completed_at','cancelled_at','updated_by','updated_at']) is distinct from
      (to_jsonb(old)-array['completed_at','cancelled_at','updated_by','updated_at']) then raise exception 'Snimak treninga je nepromenljiv.'; end if;
    if old.cancelled_at is not null then
      if new.completed_at is distinct from old.completed_at or new.cancelled_at is distinct from old.cancelled_at then raise exception 'Otkazan trening je zaključan.'; end if;
    else
      if clock_timestamp()<old.starts_at_utc then raise exception 'Trening još nije počeo.'; end if;
      if new.completed_at is distinct from old.completed_at then
        if old.completed_at is not null or new.completed_at is null then raise exception 'Završetak je nepromenljiv.'; end if;
        new.completed_at:=clock_timestamp();
      end if;
      if new.cancelled_at is distinct from old.cancelled_at then
        if new.cancelled_at is null then raise exception 'Otkazivanje je nepromenljivo.'; end if;
        new.cancelled_at:=clock_timestamp();
      end if;
    end if;
  end if;
  new.updated_by:=actor; new.updated_at:=clock_timestamp();
  return new;
end $$;
create trigger check_session before insert or update on public.training_sessions for each row execute function tkd_private.check_session();

create function tkd_private.check_attendance() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare s public.training_sessions; c public.children; actor uuid:=tkd_private.current_trainer(); initial_roster boolean;
begin
  select * into s from public.training_sessions where id=new.session_id for update;
  if not found then raise exception 'Trening ne postoji.'; end if;
  -- Only the nested AFTER INSERT session trigger can insert the initial roster.
  initial_roster:=tg_op='INSERT' and pg_trigger_depth()>1 and not coalesce(new.is_substitute,false);
  if not initial_roster then
    if s.cancelled_at is not null then raise exception 'Otkazan trening je zaključan.'; end if;
    if clock_timestamp()<s.starts_at_utc then raise exception 'Trening još nije počeo.'; end if;
  end if;
  if tg_op='INSERT' then
    select * into c from public.children where id=new.child_id for share;
    if not found then raise exception 'Dete ne postoji.'; end if;
    if initial_roster then
      if not exists(select 1 from public.term_assignments a where a.term_id=s.term_id and a.child_id=c.id
        and a.valid_from<=s.session_date and (a.valid_to is null or a.valid_to>=s.session_date)
        and (a.cancelled_at is null or a.cancelled_at>s.starts_at_utc)) then raise exception 'Dete nije u istorijskom spisku.'; end if;
    else
      if new.is_substitute is distinct from true or c.status<>'active' then raise exception 'Zamena mora biti aktivno dete.'; end if;
    end if;
    new.child_first_name:=c.first_name; new.child_last_name:=c.last_name;
    new.present:=false; new.is_substitute:=not initial_roster;
    new.created_by:=actor; new.created_at:=clock_timestamp();
  else
    if (to_jsonb(new)-array['present','updated_by','updated_at']) is distinct from
      (to_jsonb(old)-array['present','updated_by','updated_at']) then raise exception 'Snimak prisustva je nepromenljiv.'; end if;
  end if;
  new.updated_by:=actor; new.updated_at:=clock_timestamp();
  return new;
end $$;
create trigger check_attendance before insert or update on public.session_attendance for each row execute function tkd_private.check_attendance();

create function tkd_private.snapshot_roster() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.session_attendance(session_id,child_id)
    select new.id,a.child_id from public.term_assignments a
    where a.term_id=new.term_id and a.valid_from<=new.session_date and (a.valid_to is null or a.valid_to>=new.session_date)
      and (a.cancelled_at is null or a.cancelled_at>new.starts_at_utc)
    group by a.child_id;
  return null;
end $$;
create trigger snapshot_roster after insert on public.training_sessions for each row execute function tkd_private.snapshot_roster();

-- Narrow definer: trigger-only audit insert, locked path, actor rederived from auth.uid().
create function tkd_private.audit_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  select id into actor from public.trainers where user_id=auth.uid() and active;
  if actor is null then raise exception 'Pristup nije dozvoljen.'; end if;
  if tg_op='UPDATE' and to_jsonb(new)=to_jsonb(old) then return null; end if;
  insert into tkd_private.attendance_audit(entity,operation,actor_id,happened_at,before_row,after_row)
    values(tg_table_name,tg_op,actor,clock_timestamp(),case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
  return null;
end $$;
do $$ declare n text; begin
  foreach n in array array['training_sessions','session_attendance','term_assignments','weekly_terms'] loop
    execute format('create trigger z_audit_attendance after insert or update on public.%I for each row execute function tkd_private.audit_attendance()',n);
  end loop;
end $$;
create function tkd_private.reject_audit_change() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin raise exception 'Audit je nepromenljiv.'; end $$;
create trigger immutable_audit before update or delete on tkd_private.attendance_audit
  for each row execute function tkd_private.reject_audit_change();

create function public.ensure_session(p_session_date date,p_term_id uuid) returns public.training_sessions
language plpgsql security invoker set search_path = '' as $$
declare s public.training_sessions; t public.weekly_terms; starts_at_utc timestamptz;
begin
  perform tkd_private.attendance_lock();
  select * into s from public.training_sessions where term_id=p_term_id and session_date=p_session_date;
  if found then return s; end if;
  select * into t from public.weekly_terms where id=p_term_id for update;
  if not found then raise exception 'Termin ne postoji.'; end if;
  starts_at_utc:=(p_session_date+t.starts_at) at time zone 'Europe/Belgrade';
  if clock_timestamp()<starts_at_utc then raise exception 'Trening još nije počeo.'; end if;
  insert into public.training_sessions(term_id,session_date) values(p_term_id,p_session_date) returning * into s;
  return s;
end $$;
create function public.set_presence(p_session_id uuid,p_child_id uuid,p_present boolean) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform tkd_private.attendance_lock();
  if p_present is null then raise exception 'Prisustvo mora biti boolean.'; end if;
  update public.session_attendance set present=p_present where session_id=p_session_id and child_id=p_child_id;
  if not found then raise exception 'Dete nije u spisku treninga.'; end if;
end $$;
create function public.add_substitute(p_session_id uuid,p_child_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare s public.training_sessions;
begin
  perform tkd_private.attendance_lock();
  select * into s from public.training_sessions where id=p_session_id for update;
  if not found then raise exception 'Trening ne postoji.'; end if;
  if s.cancelled_at is not null then raise exception 'Otkazan trening je zaključan.'; end if;
  if clock_timestamp()<s.starts_at_utc then raise exception 'Trening još nije počeo.'; end if;
  -- Existing expected/substitute row is canonical; never relabel/reset it.
  if exists(select 1 from public.session_attendance where session_id=p_session_id and child_id=p_child_id) then return; end if;
  insert into public.session_attendance(session_id,child_id,is_substitute) values(p_session_id,p_child_id,true);
end $$;
create function public.complete_session(p_session_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare s public.training_sessions;
begin
  perform tkd_private.attendance_lock();
  select * into s from public.training_sessions where id=p_session_id for update;
  if not found then raise exception 'Trening ne postoji.'; end if;
  if s.cancelled_at is not null then raise exception 'Otkazan trening je zaključan.'; end if;
  if clock_timestamp()<s.starts_at_utc then raise exception 'Trening još nije počeo.'; end if;
  if s.completed_at is null then update public.training_sessions set completed_at=clock_timestamp() where id=p_session_id; end if;
end $$;
create function public.cancel_session(p_session_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare s public.training_sessions;
begin
  perform tkd_private.attendance_lock();
  select * into s from public.training_sessions where id=p_session_id for update;
  if not found then raise exception 'Trening ne postoji.'; end if;
  if clock_timestamp()<s.starts_at_utc then raise exception 'Trening još nije počeo.'; end if;
  if s.cancelled_at is null then update public.training_sessions set cancelled_at=clock_timestamp() where id=p_session_id; end if;
end $$;
create function public.cancel_enrollment(p_term_id uuid,p_child_id uuid,p_valid_from date) returns void
language plpgsql security invoker set search_path = '' as $$
declare a public.term_assignments;
begin
  perform tkd_private.attendance_lock();
  select * into a from public.term_assignments where term_id=p_term_id and child_id=p_child_id and valid_from=p_valid_from for update;
  if not found then raise exception 'Upis ne postoji.'; end if;
  if a.cancelled_at is null then
    update public.term_assignments set cancelled_at=clock_timestamp() where term_id=p_term_id and child_id=p_child_id and valid_from=p_valid_from;
  end if;
end $$;
create function public.get_server_time() returns timestamptz
language plpgsql volatile security invoker set search_path = '' as $$
begin perform tkd_private.current_trainer(); return clock_timestamp(); end $$;

revoke all on function tkd_private.current_trainer(), tkd_private.attendance_lock(), tkd_private.lock_attendance_write(),
  tkd_private.term_metadata(), tkd_private.check_session(), tkd_private.check_attendance(), tkd_private.snapshot_roster(),
  tkd_private.audit_attendance(), tkd_private.reject_audit_change() from public, anon, authenticated;
-- Only these non-definer helpers are needed by invoker RPCs/triggers.
grant execute on function tkd_private.current_trainer(), tkd_private.attendance_lock() to authenticated;
revoke all on function public.ensure_session(date,uuid),public.set_presence(uuid,uuid,boolean),public.add_substitute(uuid,uuid),
  public.complete_session(uuid),public.cancel_session(uuid),public.cancel_enrollment(uuid,uuid,date),public.get_server_time(),
  public.save_term(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.ensure_session(date,uuid),public.set_presence(uuid,uuid,boolean),public.add_substitute(uuid,uuid),
  public.complete_session(uuid),public.cancel_session(uuid),public.cancel_enrollment(uuid,uuid,date),public.get_server_time(),
  public.save_term(jsonb,jsonb) to authenticated;
reset search_path;

