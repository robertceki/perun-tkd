-- A recorded training retains its schedule ID as historical data.
alter table public.training_sessions drop constraint training_sessions_term_id_fkey;

-- Upisi belong to the live schedule. Their original values are retained in the audit on deletion.
alter table public.term_assignments
  drop constraint term_assignments_term_id_fkey,
  add constraint term_assignments_term_id_fkey foreign key (term_id) references public.weekly_terms(id) on delete cascade;

drop trigger protect_term_deletion_history on public.weekly_terms;
create or replace function tkd_private.protect_term_deletion_history() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  -- The foreign-key cascade can remove enrollments only after deleting their parent schedule.
  if not exists(select 1 from public.weekly_terms where id=old.term_id) then return old; end if;
  if old.cancelled_at is not null or old.valid_from <= (clock_timestamp() at time zone 'Europe/Belgrade')::date
    or exists(select 1 from public.training_sessions where term_id=old.term_id) then
    raise exception 'Istorijski upis se ne može obrisati.';
  end if;
  return old;
end $$;

create or replace function tkd_private.audit_attendance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  select id into actor from public.trainers where user_id=auth.uid() and active;
  if actor is null then raise exception 'Pristup nije dozvoljen.'; end if;
  if tg_op='UPDATE' and to_jsonb(new)=to_jsonb(old) then return null; end if;
  insert into tkd_private.attendance_audit(entity,operation,actor_id,happened_at,before_row,after_row)
    values(tg_table_name,tg_op,actor,clock_timestamp(),
      case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
      case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end);
  return null;
end $$;

create trigger z_audit_term_deletion after delete on public.weekly_terms
for each row execute function tkd_private.audit_attendance();
create trigger z_audit_enrollment_deletion after delete on public.term_assignments
for each row execute function tkd_private.audit_attendance();

create function public.delete_term(p_term_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform tkd_private.attendance_lock();
  delete from public.weekly_terms where id=p_term_id;
  if not found then raise exception 'Termin ne postoji.'; end if;
end $$;

revoke all on function public.delete_term(uuid) from public, anon, authenticated;
grant execute on function public.delete_term(uuid) to authenticated;

CREATE OR REPLACE FUNCTION tkd_private.check_term()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' and exists(select 1 from public.training_sessions where term_id=new.id) then
    raise exception 'Identifikator je već sačuvan u istoriji treninga.';
  end if;
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
      (new.group_id,new.weekday,new.starts_at,new.ends_at,new.trainer_id) is distinct from
      (old.group_id,old.weekday,old.starts_at,old.ends_at,old.trainer_id) then
      raise exception 'Za promenu povezanog rasporeda napravite novi termin.';
    end if;

  end if;
  return new;
end;
$function$
;

create or replace function public.ensure_session(p_session_date date,p_term_id uuid) returns public.training_sessions
language plpgsql security invoker set search_path = '' as $$
declare s public.training_sessions; t public.weekly_terms; starts_at_utc timestamptz;
begin
  perform tkd_private.attendance_lock();
  select * into s from public.training_sessions where term_id=p_term_id and session_date=p_session_date;
  if found then
    if s.completed_at is null and s.cancelled_at is null and clock_timestamp() < s.starts_at_utc
      and exists(select 1 from public.weekly_terms where id=s.term_id) then
      insert into public.session_attendance(session_id,child_id)
        select s.id,c.id from public.children c join public.groups g on g.id=s.group_id
        where c.status='active' and (g.id=c.main_group_id or g.id=c.competition_group_id)
          and (g.kind<>'competition' or c.member_type='competitor')
          and not exists (select 1 from public.session_attendance a where a.session_id=s.id and a.child_id=c.id)
        on conflict (session_id,child_id) do nothing;
    end if;
    return s;
  end if;
  select * into t from public.weekly_terms where id=p_term_id for update;
  if not found then raise exception 'Termin ne postoji.'; end if;
  starts_at_utc:=(p_session_date+t.starts_at) at time zone 'Europe/Belgrade';
  if clock_timestamp() < starts_at_utc - interval '60 minutes' then raise exception 'Evidencija prisustva se otvara 60 minuta pre zakazanog početka treninga.'; end if;
  insert into public.training_sessions(term_id,session_date) values(p_term_id,p_session_date) returning * into s;
  return s;
end $$;
