create function tkd_private.protect_term_deletion_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='term_assignments' then
    if old.cancelled_at is not null or old.valid_from <= (clock_timestamp() at time zone 'Europe/Belgrade')::date
      or exists(select 1 from public.training_sessions where term_id=old.term_id) then
      raise exception 'Istorijski upis se ne može obrisati.';
    end if;
  else
    if exists(select 1 from public.training_sessions where term_id=old.id)
      or exists(select 1 from public.term_assignments where term_id=old.id) then
      raise exception 'Termin ima povezane podatke ili istoriju.';
    end if;
  end if;
  return old;
end $$;
create trigger protect_term_deletion_history before delete on public.weekly_terms for each row execute function tkd_private.protect_term_deletion_history();
create trigger protect_enrollment_deletion_history before delete on public.term_assignments for each row execute function tkd_private.protect_term_deletion_history();
revoke all on function tkd_private.protect_term_deletion_history() from public,anon,authenticated;
