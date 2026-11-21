CREATE OR REPLACE FUNCTION tkd_private.check_term()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      (new.group_id,new.weekday,new.starts_at,new.ends_at,new.trainer_id) is distinct from
      (old.group_id,old.weekday,old.starts_at,old.ends_at,old.trainer_id) then
      raise exception 'Za promenu povezanog rasporeda napravite novi termin.';
    end if;

  end if;
  return new;
end;
$function$
;

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
end $function$
;

CREATE OR REPLACE FUNCTION tkd_private.check_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.weekly_terms; actor uuid:=tkd_private.current_trainer();
begin
  if tg_op='INSERT' then
    select * into t from public.weekly_terms where id=new.term_id for update;
    if not found then raise exception 'Termin ne postoji.'; end if;
    if not isfinite(new.session_date)
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
end $function$
;

CREATE OR REPLACE FUNCTION public.save_term(p_term jsonb, p_assignments jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    trainer_id=coalesce(t.trainer_id,trainer_id),active=t.active where id=t.id;
  if not found then
    insert into public.weekly_terms(id,group_id,weekday,starts_at,ends_at,trainer_id,active)
      values(t.id,t.group_id,t.weekday,t.starts_at,t.ends_at,t.trainer_id,t.active);
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
end $function$
;
alter table public.weekly_terms drop column valid_from, drop column valid_to;
