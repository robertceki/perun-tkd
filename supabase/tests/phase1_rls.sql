-- Parent sets tkd.r1_trainer_uid to the approved existing trainer's auth UID
-- in the same connection before running this script. Requires D1 + A2.
begin;

set local role anon;
do $$
begin
  begin
    perform 1 from public.children;
    raise exception 'Anonymous children read succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_child('{}', '[]');
    raise exception 'Anonymous save_child succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
set local role authenticated;
do $$
begin
  if exists(select 1 from public.children) or exists(select 1 from public.contacts) then
    raise exception 'Nontrainer can see club data';
  end if;
  begin
    perform public.save_child('{}', '[]');
    raise exception 'Nontrainer save_child succeeded';
  exception when raise_exception then
    if sqlerrm <> 'Pristup nije dozvoljen.' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('tkd.r1_trainer_uid'), true);
set local role authenticated;
do $$
declare
  group_id uuid := gen_random_uuid();
  kid_id uuid := gen_random_uuid();
  parent_id uuid := gen_random_uuid();
  child_data jsonb;
  links jsonb;
begin
  if not tkd_private.is_active_trainer() then raise exception 'Approved trainer is not active'; end if;
  insert into public.groups(id,name,kind) values (group_id,'R1 group','main');
  insert into public.contacts(id,first_name,last_name,phone) values (parent_id,'R1','Parent','000');
  child_data := jsonb_build_object('id',kid_id,'first_name','R1','last_name','Child','birth_date','2015-01-01',
    'status','active','main_group_id',group_id,'address','','belt','');
  links := jsonb_build_array(jsonb_build_object('child_id',kid_id,'contact_id',parent_id,'relationship','parent','is_primary',true));
  perform public.save_child(child_data,links);
  begin
    perform public.save_child(child_data || '{"first_name":"Should roll back"}', '[]');
    raise exception 'Invalid child aggregate save succeeded';
  exception when raise_exception then
    if sqlerrm <> 'Dete mora imati tačno jedan glavni kontakt.' then raise; end if;
  end;
  if not exists(select 1 from public.children c where c.id=kid_id and c.first_name='R1')
     or (select count(*) from public.child_contacts l where l.child_id=(child_data->>'id')::uuid and l.is_primary) <> 1 then
    raise exception 'Failed aggregate save changed child or links';
  end if;
end $$;
rollback;
