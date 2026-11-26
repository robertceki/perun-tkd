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
      if new.completed_at is distinct from old.completed_at or (new.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at) then raise exception 'Otkazan trening je zaključan.'; end if;
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

create function public.restore_session(p_session_id uuid, p_cancelled_at timestamptz) returns void
language plpgsql security invoker set search_path = '' as $$
declare s public.training_sessions;
begin
  perform tkd_private.attendance_lock();
  if p_cancelled_at is null then raise exception 'Vreme otkazivanja je obavezno.'; end if;
  select * into s from public.training_sessions where id=p_session_id for update;
  if not found then raise exception 'Trening ne postoji.'; end if;
  if s.cancelled_at is null then return; end if;
  if s.cancelled_at is distinct from p_cancelled_at then
    raise exception 'Status treninga se promenio. Ponovo učitajte podatke.';
  end if;
  update public.training_sessions set cancelled_at=null where id=p_session_id;
end $$;

revoke all on function public.restore_session(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.restore_session(uuid,timestamptz) to authenticated;
