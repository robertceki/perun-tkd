alter table public.children add column registration_number text;
alter table public.session_attendance add column child_registration_number text;

-- Existing profiles and attendance snapshots can predate registration numbers.
create function tkd_private.check_child_registration_number() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.registration_number := nullif(regexp_replace(new.registration_number, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if new.registration_number is null and (tg_op = 'INSERT' or old.registration_number is not null) then
    raise exception 'Unesite registarski broj deteta.';
  end if;
  return new;
end $$;

create trigger check_child_registration_number before insert or update of registration_number on public.children
for each row execute function tkd_private.check_child_registration_number();
revoke all on function tkd_private.check_child_registration_number() from public, anon, authenticated;

create or replace function public.save_child(p_child jsonb, p_contacts jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare c public.children; link public.child_contacts;
begin
  if not tkd_private.is_active_trainer() then raise exception 'Pristup nije dozvoljen.'; end if;
  if jsonb_typeof(p_child) is distinct from 'object' or jsonb_typeof(p_contacts) is distinct from 'array' then raise exception 'Neispravan zahtev.'; end if;
  if p_child ? 'registration_number' and jsonb_typeof(p_child->'registration_number') is distinct from 'string' then
    raise exception 'Registarski broj mora biti tekst.';
  end if;
  if p_child ? 'registration_number' and (p_child->>'registration_number') ~ '^[[:space:]]*$' then
    raise exception 'Unesite registarski broj deteta.';
  end if;
  c := jsonb_populate_record(null::public.children,p_child);
  if c.notes ~ '^[[:space:]]*$' then
    c.notes := null;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.id::text,0));
  update public.children as child set
    registration_number=case when p_child ? 'registration_number' then c.registration_number else child.registration_number end,
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
      sex, member_type, competition_class, weight_category_id, registration_number
    ) values (
      c.id, btrim(c.first_name), btrim(c.last_name), c.birth_date, c.address, c.belt,
      c.status, c.main_group_id, c.competition_group_id, c.notes, c.medical_exam_date,
      c.sex, c.member_type, c.competition_class, c.weight_category_id, c.registration_number
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
