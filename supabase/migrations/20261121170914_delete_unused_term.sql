create or replace function public.delete_unused_term(p_term_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform tkd_private.attendance_lock();
  if not tkd_private.is_active_trainer() then raise exception 'Pristup nije dozvoljen.'; end if;
  perform 1 from public.weekly_terms where id=p_term_id for update;
  if not found then raise exception 'Termin ne postoji.'; end if;
  if exists(select 1 from public.training_sessions where term_id=p_term_id)
    or exists(select 1 from public.term_assignments where term_id=p_term_id and
      (cancelled_at is not null or valid_from <= (clock_timestamp() at time zone 'Europe/Belgrade')::date)) then
    raise exception 'Termin ima istoriju treninga ili upisa. Možete ga deaktivirati.';
  end if;
  delete from public.term_assignments where term_id=p_term_id;
  delete from public.weekly_terms where id=p_term_id;
end $$;
revoke all on function public.delete_unused_term(uuid) from public, anon;
grant execute on function public.delete_unused_term(uuid) to authenticated;
grant delete on public.weekly_terms, public.term_assignments to authenticated;
