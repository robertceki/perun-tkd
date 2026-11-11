create or replace function tkd_private.check_session() returns trigger
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
    if clock_timestamp() < new.starts_at_utc - interval '60 minutes' then raise exception 'Evidencija prisustva se otvara 60 minuta pre zakazanog početka treninga.'; end if;
    new.completed_at:=null; new.cancelled_at:=null;
    new.created_by:=actor; new.created_at:=clock_timestamp();
  else
    if (to_jsonb(new)-array['completed_at','cancelled_at','updated_by','updated_at']) is distinct from
      (to_jsonb(old)-array['completed_at','cancelled_at','updated_by','updated_at']) then raise exception 'Snimak treninga je nepromenljiv.'; end if;
    if old.cancelled_at is not null then
      if new.completed_at is distinct from old.completed_at or new.cancelled_at is distinct from old.cancelled_at then raise exception 'Otkazan trening je zaključan.'; end if;
    else
      if clock_timestamp() < old.starts_at_utc - interval '60 minutes' then raise exception 'Evidencija prisustva se otvara 60 minuta pre zakazanog početka treninga.'; end if;
      if new.completed_at is distinct from old.completed_at then
        if old.completed_at is not null or new.completed_at is null then raise exception 'Završetak je nepromenljiv.'; end if;
        new.completed_at:=clock_timestamp();
      end if;
      if new.cancelled_at is distinct from old.cancelled_at then
        if clock_timestamp() < old.starts_at_utc then raise exception 'Trening još nije počeo.'; end if;
        if new.cancelled_at is null then raise exception 'Otkazivanje je nepromenljivo.'; end if;
        new.cancelled_at:=clock_timestamp();
      end if;
    end if;
  end if;
  new.updated_by:=actor; new.updated_at:=clock_timestamp();
  return new;
end $$;

create or replace function tkd_private.check_attendance() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare s public.training_sessions; c public.children; actor uuid:=tkd_private.current_trainer(); initial_roster boolean;
begin
  select * into s from public.training_sessions where id=new.session_id for update;
  if not found then raise exception 'Trening ne postoji.'; end if;
  -- Only the nested AFTER INSERT session trigger can insert the initial roster.
  initial_roster:=tg_op='INSERT' and pg_trigger_depth()>1 and not coalesce(new.is_substitute,false);
  if not initial_roster then
    if s.cancelled_at is not null then raise exception 'Otkazan trening je zaključan.'; end if;
    if clock_timestamp() < s.starts_at_utc - interval '60 minutes' then raise exception 'Evidencija prisustva se otvara 60 minuta pre zakazanog početka treninga.'; end if;
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

create or replace function public.ensure_session(p_session_date date,p_term_id uuid) returns public.training_sessions
language plpgsql security invoker set search_path = '' as $$
declare s public.training_sessions; t public.weekly_terms; starts_at_utc timestamptz;
begin
  perform tkd_private.attendance_lock();
  select * into s from public.training_sessions where term_id=p_term_id and session_date=p_session_date;
  if found then return s; end if;
  select * into t from public.weekly_terms where id=p_term_id for update;
  if not found then raise exception 'Termin ne postoji.'; end if;
  starts_at_utc:=(p_session_date+t.starts_at) at time zone 'Europe/Belgrade';
  if clock_timestamp() < starts_at_utc - interval '60 minutes' then raise exception 'Evidencija prisustva se otvara 60 minuta pre zakazanog početka treninga.'; end if;
  insert into public.training_sessions(term_id,session_date) values(p_term_id,p_session_date) returning * into s;
  return s;
end $$;

create or replace function public.add_substitute(p_session_id uuid,p_child_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare s public.training_sessions;
begin
  perform tkd_private.attendance_lock();
  select * into s from public.training_sessions where id=p_session_id for update;
  if not found then raise exception 'Trening ne postoji.'; end if;
  if s.cancelled_at is not null then raise exception 'Otkazan trening je zaključan.'; end if;
  if clock_timestamp() < s.starts_at_utc - interval '60 minutes' then raise exception 'Evidencija prisustva se otvara 60 minuta pre zakazanog početka treninga.'; end if;
  -- Existing expected/substitute row is canonical; never relabel/reset it.
  if exists(select 1 from public.session_attendance where session_id=p_session_id and child_id=p_child_id) then return; end if;
  insert into public.session_attendance(session_id,child_id,is_substitute) values(p_session_id,p_child_id,true);
end $$;

create or replace function public.complete_session(p_session_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare s public.training_sessions;
begin
  perform tkd_private.attendance_lock();
  select * into s from public.training_sessions where id=p_session_id for update;
  if not found then raise exception 'Trening ne postoji.'; end if;
  if s.cancelled_at is not null then raise exception 'Otkazan trening je zaključan.'; end if;
  if clock_timestamp() < s.starts_at_utc - interval '60 minutes' then raise exception 'Evidencija prisustva se otvara 60 minuta pre zakazanog početka treninga.'; end if;
  if s.completed_at is null then update public.training_sessions set completed_at=clock_timestamp() where id=p_session_id; end if;
end $$;
