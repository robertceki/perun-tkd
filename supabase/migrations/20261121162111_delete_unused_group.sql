-- Foreign keys protect referenced groups, including concurrent child/term/session inserts.
grant delete on public.groups to authenticated;

create or replace function public.delete_unused_group(p_group_id uuid) returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if not tkd_private.is_active_trainer() then
    raise exception 'Pristup nije dozvoljen.';
  end if;
  perform 1 from public.groups where id = p_group_id for update;
  if not found then
    raise exception 'Grupa ne postoji.';
  end if;
  if exists(select 1 from public.children where main_group_id = p_group_id or competition_group_id = p_group_id)
    or exists(select 1 from public.weekly_terms where group_id = p_group_id)
    or exists(select 1 from public.training_sessions where group_id = p_group_id) then
    raise exception 'Grupa ima povezane podatke ili istoriju. Možete je deaktivirati.';
  end if;
  delete from public.groups where id = p_group_id;
end;
$$;

revoke all on function public.delete_unused_group(uuid) from public, anon;
grant execute on function public.delete_unused_group(uuid) to authenticated;
