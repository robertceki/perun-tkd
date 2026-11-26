alter table public.children alter column main_group_id drop not null;
alter table public.children drop constraint children_check;
alter table public.children add constraint children_distinct_groups
  check (main_group_id is null or competition_group_id is null or main_group_id <> competition_group_id);

create or replace function tkd_private.check_child() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare g public.groups; age_years integer; expected_age text;
begin
  if new.birth_date > (clock_timestamp() at time zone 'Europe/Belgrade')::date then
    raise exception 'Datum rođenja ne može biti u budućnosti.';
  end if;
  if tg_op='INSERT' and new.sex is null then raise exception 'Pol je obavezan za novo dete.'; end if;
  if new.member_type='recreational' and new.competition_group_id is not null
    and (tg_op='INSERT' or old.member_type is distinct from 'recreational'
      or new.competition_group_id is distinct from old.competition_group_id)
  then raise exception 'Takmičarska grupa zahteva takmičara.'; end if;
  if new.weight_category_id is not null and (
    tg_op='INSERT' or (new.weight_category_id,new.sex,new.birth_date) is distinct from
      (old.weight_category_id,old.sex,old.birth_date)
  ) then
    age_years := extract(year from statement_timestamp() at time zone 'Europe/Belgrade') - extract(year from new.birth_date);
    expected_age := case
      when age_years >= 18 then 'seniors'
      when age_years >= 15 then 'juniors'
      when age_years >= 12 then 'cadets'
      when age_years >= 10 then 'older_pioneers'
      when age_years >= 8 then 'younger_pioneers'
      when age_years >= 6 then 'rev_pioneers'
    end;
    if not exists (
      select 1 from public.weight_categories w
      where w.id=new.weight_category_id and w.sex=new.sex and w.age_category=expected_age
    ) then raise exception 'Težinska kategorija ne odgovara polu i uzrastu deteta.'; end if;
  end if;
  if new.main_group_id is not null then
    select * into g from public.groups where id=new.main_group_id for share;
    if not found or g.kind<>'main' then raise exception 'Glavna grupa nije ispravna.'; end if;
    if not g.active and (tg_op='INSERT' or new.main_group_id is distinct from old.main_group_id) then raise exception 'Glavna grupa nije aktivna.'; end if;
  elsif tg_op='INSERT' then
    raise exception 'Izaberite glavnu grupu odgovarajuće vrste.';
  end if;
  if new.competition_group_id is not null then
    select * into g from public.groups where id=new.competition_group_id for share;
    if not found or g.kind<>'competition' then raise exception 'Takmičarska grupa nije ispravna.'; end if;
    if not g.active and (tg_op='INSERT' or new.competition_group_id is distinct from old.competition_group_id) then raise exception 'Takmičarska grupa nije aktivna.'; end if;
  end if;
  if tg_op='UPDATE' and exists (
    select 1 from public.term_assignments a join public.weekly_terms t on t.id=a.term_id
    where a.child_id=new.id and a.cancelled_at is null
      and (a.valid_to is null or a.valid_to >= (clock_timestamp() at time zone 'Europe/Belgrade')::date)
      and (new.status<>'active' or (t.group_id is distinct from new.main_group_id and t.group_id is distinct from new.competition_group_id))
  ) then raise exception 'Najpre završite postojeće upise deteta.'; end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION tkd_private.check_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if not (tg_op='UPDATE' and (new is not distinct from old or closing)) then
    if not t.active or c.status<>'active' or (t.group_id is distinct from c.main_group_id and t.group_id is distinct from c.competition_group_id) then raise exception 'Dete nije podobno za ovaj termin.'; end if;
    if c.member_type='recreational' and exists (
      select 1 from public.groups where id=t.group_id and kind='competition'
    ) then raise exception 'Upis u takmičarski termin zahteva takmičara.'; end if;
    perform 1 from public.groups where id=t.group_id and active;
    if not found then raise exception 'Grupa termina nije aktivna.'; end if;
    perform 1 from public.trainers where id=t.trainer_id and active;
    if not found then raise exception 'Trener termina nije aktivan.'; end if;
  end if;
  return new;
end $function$
;

create function public.remove_group_member(p_group_id uuid, p_child_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare member public.children;
begin
  perform tkd_private.attendance_lock();
  if p_group_id is null then raise exception 'Grupa ne postoji.'; end if;
  select * into member from public.children where id=p_child_id for update;
  if not found then raise exception 'Član ne postoji.'; end if;
  if p_group_id is distinct from member.main_group_id and p_group_id is distinct from member.competition_group_id then
    return;
  end if;

  -- End this group's live enrollments without changing recorded training or other groups.
  update public.term_assignments a set cancelled_at=clock_timestamp()
  from public.weekly_terms t
  where a.term_id=t.id and t.group_id=p_group_id and a.child_id=p_child_id
    and a.cancelled_at is null and (a.valid_to is null or a.valid_to >= (clock_timestamp() at time zone 'Europe/Belgrade')::date);

  update public.children set
    main_group_id=case when main_group_id=p_group_id then null else main_group_id end,
    competition_group_id=case when competition_group_id=p_group_id then null else competition_group_id end
  where id=p_child_id;
end $$;

revoke all on function public.remove_group_member(uuid,uuid) from public, anon, authenticated;
grant execute on function public.remove_group_member(uuid,uuid) to authenticated;
