create or replace function tkd_private.check_attendance() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare s public.training_sessions; c public.children; actor uuid:=tkd_private.current_trainer(); initial_roster boolean; regular_row boolean; group_member boolean;
begin
  select * into s from public.training_sessions where id=new.session_id for update;
  if not found then raise exception 'Trening ne postoji.'; end if;
  -- Only the nested session trigger may seed a historical roster.
  initial_roster:=tg_op='INSERT' and pg_trigger_depth()>1 and not coalesce(new.is_substitute,false);
  if not initial_roster then
    if s.cancelled_at is not null then raise exception 'Otkazan trening je zaključan.'; end if;
    if clock_timestamp() < s.starts_at_utc - interval '60 minutes' then raise exception 'Evidencija prisustva se otvara 60 minuta pre zakazanog početka treninga.'; end if;
  end if;
  if tg_op='INSERT' then
    select * into c from public.children where id=new.child_id for share;
    if not found then raise exception 'Dete ne postoji.'; end if;
    regular_row := not coalesce(new.is_substitute,false);
    group_member := c.status='active' and exists (
      select 1 from public.groups g where g.id=s.group_id
        and (g.id=c.main_group_id or g.id=c.competition_group_id)
        and (g.kind<>'competition' or c.member_type='competitor')
    );
    if initial_roster then
      if not (group_member and s.session_date >= (clock_timestamp() at time zone 'Europe/Belgrade')::date)
        and not exists(select 1 from public.term_assignments a where a.term_id=s.term_id and a.child_id=c.id
          and a.valid_from<=s.session_date and (a.valid_to is null or a.valid_to>=s.session_date)
          and (a.cancelled_at is null or a.cancelled_at>s.starts_at_utc))
      then raise exception 'Dete nije u planiranom spisku.'; end if;
    elsif regular_row then
      if not group_member or s.completed_at is not null or clock_timestamp()>=s.starts_at_utc then
        raise exception 'Redovan upis zahteva člana grupe i predstojeći trening.';
      end if;
    else
      if new.is_substitute is distinct from true or c.status<>'active' then raise exception 'Zamena mora biti aktivno dete.'; end if;
      if c.member_type='recreational' and exists (
        select 1 from public.groups where id=s.group_id and kind='competition'
      ) then raise exception 'Zamena na takmičarskom treningu zahteva takmičara.'; end if;
    end if;
    new.child_first_name:=c.first_name; new.child_last_name:=c.last_name;
    new.present:=false; new.is_substitute:=not regular_row;
    new.created_by:=actor; new.created_at:=clock_timestamp();
  else
    if (to_jsonb(new)-array['present','updated_by','updated_at']) is distinct from
      (to_jsonb(old)-array['present','updated_by','updated_at']) then raise exception 'Snimak prisustva je nepromenljiv.'; end if;
  end if;
  new.updated_by:=actor; new.updated_at:=clock_timestamp();
  return new;
end $$;

create or replace function tkd_private.snapshot_roster() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.session_attendance(session_id,child_id)
    select new.id, eligible.child_id
    from (
      select a.child_id from public.term_assignments a
      where a.term_id=new.term_id and a.valid_from<=new.session_date
        and (a.valid_to is null or a.valid_to>=new.session_date)
        and (a.cancelled_at is null or a.cancelled_at>new.starts_at_utc)
      union
      select c.id from public.children c join public.groups g on g.id=new.group_id
      where new.session_date >= (clock_timestamp() at time zone 'Europe/Belgrade')::date
        and c.status='active' and (g.id=c.main_group_id or g.id=c.competition_group_id)
        and (g.kind<>'competition' or c.member_type='competitor')
    ) eligible;
  return null;
end $$;

create or replace function public.ensure_session(p_session_date date,p_term_id uuid) returns public.training_sessions
language plpgsql security invoker set search_path = '' as $$
declare s public.training_sessions; t public.weekly_terms; starts_at_utc timestamptz;
begin
  perform tkd_private.attendance_lock();
  select * into s from public.training_sessions where term_id=p_term_id and session_date=p_session_date;
  if found then
    if s.completed_at is null and s.cancelled_at is null and clock_timestamp() < s.starts_at_utc then
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
