-- Recorded trainings keep the original group identifier and name as historical data.
alter table public.training_sessions drop constraint training_sessions_group_id_fkey;

create function tkd_private.protect_historical_group_id() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  -- An upsert of a still-existing group is allowed, but its deleted ID cannot be reused.
  if exists(select 1 from public.training_sessions where group_id=new.id)
    and not exists(select 1 from public.groups where id=new.id) then
    raise exception 'Identifikator grupe je već sačuvan u istoriji treninga.';
  end if;
  return new;
end $$;

create trigger protect_historical_group_id before insert on public.groups
for each row execute function tkd_private.protect_historical_group_id();
revoke all on function tkd_private.protect_historical_group_id() from public, anon, authenticated;

create trigger z_audit_group_deletion after delete on public.groups
for each row execute function tkd_private.audit_attendance();

create function public.delete_group(p_group_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform tkd_private.attendance_lock();
  perform 1 from public.groups where id=p_group_id for update;
  if not found then raise exception 'Grupa ne postoji.'; end if;

  -- Deleting schedules archives their enrollments via the existing deletion audit.
  delete from public.weekly_terms where group_id=p_group_id;
  update public.children set
    main_group_id=case when main_group_id=p_group_id then null else main_group_id end,
    competition_group_id=case when competition_group_id=p_group_id then null else competition_group_id end
  where main_group_id=p_group_id or competition_group_id=p_group_id;

  delete from public.groups where id=p_group_id;
end $$;

revoke all on function public.delete_group(uuid) from public, anon, authenticated;
grant execute on function public.delete_group(uuid) to authenticated;

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
    if not exists(select 1 from public.groups where id=s.group_id) then
      raise exception 'Grupa treninga je obrisana. Sačuvani spisak je dostupan za pregled.';
    end if;
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
    new.child_registration_number:=c.registration_number;
    new.present:=false; new.is_substitute:=not regular_row;
    new.created_by:=actor; new.created_at:=clock_timestamp();
  else
    if (to_jsonb(new)-array['present','updated_by','updated_at']) is distinct from
      (to_jsonb(old)-array['present','updated_by','updated_at']) then raise exception 'Snimak prisustva je nepromenljiv.'; end if;
  end if;
  new.updated_by:=actor; new.updated_at:=clock_timestamp();
  return new;
end $$;
