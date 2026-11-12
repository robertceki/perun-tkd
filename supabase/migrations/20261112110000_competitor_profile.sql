create table public.weight_categories (
  id text primary key,
  age_category text not null,
  sex text not null check (sex in ('M','F')),
  signed_kg integer not null,
  sort_order integer not null,
  unique (age_category, sex, signed_kg)
);
create table public.competition_classes (
  id text primary key check (id in ('A','B'))
);
insert into public.competition_classes values ('A'), ('B');
insert into public.weight_categories
select age_category || ':' || sex || ':' || kg, age_category, sex, kg, ordinal::integer
from (values
  ('rev_pioneers', 'MF', array[-19,-21,-23,-25,-27,-29,-31,-33,-36,-39,-43,43]),
  ('younger_pioneers', 'MF', array[-19,-21,-23,-25,-27,-29,-31,-33,-36,-39,-43,43]),
  ('older_pioneers', 'MF', array[-27,-30,-33,-36,-40,-44,-48,-52,-57,57]),
  ('cadets', 'M', array[-33,-37,-41,-45,-49,-53,-57,-61,-65,65]),
  ('cadets', 'F', array[-29,-33,-37,-41,-44,-47,-51,-55,-59,59]),
  ('juniors', 'M', array[-45,-48,-51,-55,-59,-63,-68,-73,-78,78]),
  ('juniors', 'F', array[-42,-44,-46,-49,-52,-55,-59,-63,-68,68]),
  ('seniors', 'M', array[-54,-58,-63,-68,-74,-80,-87,87]),
  ('seniors', 'F', array[-46,-49,-53,-57,-62,-67,-73,73])
) as catalog(age_category, sexes, weights)
cross join (values ('M'), ('F')) as categories(sex)
cross join lateral unnest(weights) with ordinality as ordered_weights(kg, ordinal)
where strpos(sexes, sex) > 0;

alter table public.weight_categories enable row level security;
alter table public.competition_classes enable row level security;
revoke all on public.weight_categories, public.competition_classes from public, anon, authenticated;
grant select on public.weight_categories, public.competition_classes to authenticated;
create policy trainer_read on public.weight_categories for select to authenticated
  using ((select tkd_private.is_active_trainer()));
create policy trainer_read on public.competition_classes for select to authenticated
  using ((select tkd_private.is_active_trainer()));

alter table public.children
  add column sex text check (sex in ('M','F')),
  add column member_type text not null default 'recreational' check (member_type in ('recreational','competitor')),
  add column competition_class text references public.competition_classes(id),
  add column weight_category_id text references public.weight_categories(id),
  add constraint children_recreational_categories_check
    check (member_type='competitor' or (competition_class is null and weight_category_id is null));

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
    if c.member_type='recreational' and exists (
      select 1 from public.groups where id=t.group_id and kind='competition'
    ) then raise exception 'Upis u takmičarski termin zahteva takmičara.'; end if;
    perform 1 from public.groups where id=t.group_id and active;
    if not found then raise exception 'Grupa termina nije aktivna.'; end if;
    perform 1 from public.trainers where id=t.trainer_id and active;
    if not found then raise exception 'Trener termina nije aktivan.'; end if;
  end if;
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
      if c.member_type='recreational' and exists (
        select 1 from public.groups where id=s.group_id and kind='competition'
      ) then raise exception 'Zamena na takmičarskom treningu zahteva takmičara.'; end if;
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

create or replace function public.save_child(p_child jsonb, p_contacts jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare c public.children; link public.child_contacts;
begin
  if not tkd_private.is_active_trainer() then raise exception 'Pristup nije dozvoljen.'; end if;
  if jsonb_typeof(p_child) is distinct from 'object' or jsonb_typeof(p_contacts) is distinct from 'array' then raise exception 'Neispravan zahtev.'; end if;
  c := jsonb_populate_record(null::public.children,p_child);
  if c.notes ~ '^[[:space:]]*$' then
    c.notes := null;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.id::text,0));
  update public.children as child set
    first_name=case when p_child ? 'first_name' then btrim(c.first_name) else child.first_name end,
    last_name=case when p_child ? 'last_name' then btrim(c.last_name) else child.last_name end,
    birth_date=case when p_child ? 'birth_date' then c.birth_date else child.birth_date end,
    address=case when p_child ? 'address' then c.address else child.address end,
    belt=case when p_child ? 'belt' then c.belt else child.belt end,
    status=case when p_child ? 'status' then c.status else child.status end,
    main_group_id=case when p_child ? 'main_group_id' then c.main_group_id else child.main_group_id end,
    competition_group_id=case when p_child ? 'competition_group_id' then c.competition_group_id else child.competition_group_id end,
    notes=case when p_child ? 'notes' then c.notes else child.notes end,
    medical_exam_date=case when p_child ? 'medical_exam_date' then c.medical_exam_date else child.medical_exam_date end,
    sex=case when p_child ? 'sex' then c.sex else child.sex end,
    member_type=case when p_child ? 'member_type' then c.member_type else child.member_type end,
    competition_class=case when p_child ? 'competition_class' then c.competition_class else child.competition_class end,
    weight_category_id=case when p_child ? 'weight_category_id' then c.weight_category_id else child.weight_category_id end
  where child.id=c.id;
  if not found then
    if c.member_type is null then raise exception 'Tip članstva je obavezan za novo dete.'; end if;
    insert into public.children (
      id, first_name, last_name, birth_date, address, belt, status,
      main_group_id, competition_group_id, notes, medical_exam_date,
      sex, member_type, competition_class, weight_category_id
    ) values (
      c.id, btrim(c.first_name), btrim(c.last_name), c.birth_date, c.address, c.belt,
      c.status, c.main_group_id, c.competition_group_id, c.notes, c.medical_exam_date,
      c.sex, c.member_type, c.competition_class, c.weight_category_id
    );
  end if;
  -- Parent row lock serializes concurrent edits; deferred constraint validates final contacts.
  perform 1 from public.children where id=c.id for update;
  delete from public.child_contacts where child_id=c.id;
  for link in select * from jsonb_populate_recordset(null::public.child_contacts,p_contacts) loop
    if link.child_id is distinct from c.id then raise exception 'Kontakt pripada drugom detetu.'; end if;
    insert into public.child_contacts (child_id, contact_id, relationship, is_primary) values(link.child_id,link.contact_id,btrim(link.relationship),link.is_primary);
  end loop;
  if (select count(*) from public.child_contacts where child_id=c.id and is_primary) <> 1 then raise exception 'Dete mora imati tačno jedan glavni kontakt.'; end if;
end;
$$;
