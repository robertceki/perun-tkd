create table public.membership_fees (
  child_id uuid not null,
  fee_month date not null check (isfinite(fee_month) and extract(day from fee_month)=1),
  paid_on date check (isfinite(paid_on)),
  member_name text not null,
  registration_number text,
  primary key (child_id,fee_month)
);
create table public.membership_reminder_pauses (
  child_id uuid primary key references public.children(id) on delete cascade,
  paused_until date check (isfinite(paused_until)),
  note text not null default ''
);

alter table public.membership_fees enable row level security;
alter table public.membership_reminder_pauses enable row level security;
revoke all on public.membership_fees, public.membership_reminder_pauses from public, anon, authenticated;
grant select on public.membership_fees, public.membership_reminder_pauses to authenticated;
create policy trainer_fees on public.membership_fees for select to authenticated
  using ((select tkd_private.is_active_trainer()));
create policy trainer_fee_pauses on public.membership_reminder_pauses for select to authenticated
  using ((select tkd_private.is_active_trainer()));

create trigger z_audit_membership_fee after insert or update on public.membership_fees
for each row execute function tkd_private.audit_attendance();
create trigger z_audit_membership_pause after insert or update on public.membership_reminder_pauses
for each row execute function tkd_private.audit_attendance();

create function tkd_private.write_membership_fees(p_child_id uuid, p_months date[], p_paid_on date) returns void
language plpgsql security definer set search_path='' as $$
declare
  member public.children;
  business_date date := (clock_timestamp() at time zone 'Europe/Belgrade')::date;
begin
  perform tkd_private.attendance_lock();
  select * into member from public.children where id=p_child_id for share;
  if not found then raise exception 'Član ne postoji.'; end if;
  if coalesce(cardinality(p_months),0) not between 1 and 120
    or exists(select 1 from unnest(p_months) m
      where m is null or not isfinite(m) or extract(day from m)<>1 or m>business_date)
    then raise exception 'Izaberite tekući ili raniji mesec.'; end if;
  if p_paid_on is not null and (not isfinite(p_paid_on) or p_paid_on>business_date) then
    raise exception 'Datum uplate ne može biti u budućnosti.';
  end if;
  insert into public.membership_fees(child_id,fee_month,paid_on,member_name,registration_number)
    select p_child_id,m,p_paid_on,member.first_name || ' ' || member.last_name,member.registration_number
    from (select distinct unnest(p_months) as m) selected
  on conflict(child_id,fee_month) do update set paid_on=excluded.paid_on;
end $$;

create function tkd_private.write_membership_pause(p_child_id uuid, p_paused_until date, p_note text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform tkd_private.attendance_lock();
  insert into public.membership_reminder_pauses(child_id,paused_until,note)
    values (p_child_id,p_paused_until,case when p_paused_until is null then '' else btrim(coalesce(p_note,'')) end)
  on conflict(child_id) do update set paused_until=excluded.paused_until, note=excluded.note;
end $$;

create function public.save_membership_fees(p_child_id uuid, p_months date[], p_paid_on date) returns void
language sql security invoker set search_path='' as $$
  select tkd_private.write_membership_fees(p_child_id,p_months,p_paid_on);
$$;
create function public.save_membership_pause(p_child_id uuid, p_paused_until date, p_note text) returns void
language sql security invoker set search_path='' as $$
  select tkd_private.write_membership_pause(p_child_id,p_paused_until,p_note);
$$;

revoke all on function tkd_private.write_membership_fees(uuid,date[],date), tkd_private.write_membership_pause(uuid,date,text),
  public.save_membership_fees(uuid,date[],date), public.save_membership_pause(uuid,date,text) from public, anon, authenticated;
grant execute on function tkd_private.write_membership_fees(uuid,date[],date), tkd_private.write_membership_pause(uuid,date,text),
  public.save_membership_fees(uuid,date[],date), public.save_membership_pause(uuid,date,text) to authenticated;
