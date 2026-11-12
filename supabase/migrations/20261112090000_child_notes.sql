alter table public.children add column notes text;

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
  update public.children as child set first_name=btrim(c.first_name),last_name=btrim(c.last_name),birth_date=c.birth_date,address=c.address,belt=c.belt,status=c.status,main_group_id=c.main_group_id,competition_group_id=c.competition_group_id,
    notes=case when p_child ? 'notes' then c.notes else child.notes end
  where child.id=c.id;
  if not found then
    insert into public.children (
      id, first_name, last_name, birth_date, address, belt, status,
      main_group_id, competition_group_id, notes
    ) values (
      c.id, btrim(c.first_name), btrim(c.last_name), c.birth_date, c.address, c.belt,
      c.status, c.main_group_id, c.competition_group_id, c.notes
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
