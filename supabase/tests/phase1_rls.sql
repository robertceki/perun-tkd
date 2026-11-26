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
    'status','active','main_group_id',group_id,'address','','belt','','sex','F','member_type','recreational');
  links := jsonb_build_array(jsonb_build_object('child_id',kid_id,'contact_id',parent_id,'relationship','parent','is_primary',true));
  begin
    perform public.save_child(child_data,links);
    raise exception 'New child without registration number accepted';
  exception when raise_exception then
    if sqlerrm <> 'Unesite registarski broj deteta.' then raise; end if;
  end;
  child_data := child_data || '{"registration_number":"  0001/A  "}';
  perform public.save_child(child_data,links);
  if not exists(select 1 from public.children where id=kid_id and registration_number='0001/A') then
    raise exception 'Registration number lost its string value';
  end if;
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
  perform public.save_membership_fees(kid_id,array[date '2026-01-01',date '2026-02-01',date '2026-03-01'],date '2026-03-10');
  if (select count(*) from public.membership_fees where child_id=kid_id and paid_on=date '2026-03-10'
      and member_name='R1 Child' and registration_number='0001/A') <> 3 then
    raise exception 'Batch payment did not preserve all three months and member details';
  end if;
  perform public.save_membership_fees(kid_id,array[date '2026-01-01'],null);
  if (select count(*) from public.membership_fees where child_id=kid_id and paid_on is not null) <> 2 then
    raise exception 'Correcting one month modified other months';
  end if;
  perform public.save_membership_pause(kid_id,date '2099-01-01','  Dogovor  ');
  if not exists(select 1 from public.membership_reminder_pauses where child_id=kid_id and paused_until=date '2099-01-01' and note='Dogovor') then
    raise exception 'Reminder pause was not saved';
  end if;
  perform public.save_membership_pause(kid_id,null,'');
  if not exists(select 1 from public.membership_reminder_pauses where child_id=kid_id and paused_until is null and note='') then
    raise exception 'Reminder pause was not cleared';
  end if;
  begin
    insert into public.membership_fees values(kid_id,date '2026-04-01',null,'R1 Child','0001/A');
    raise exception 'Direct membership fee write succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  if (select count(*) from tkd_private.attendance_audit where entity='membership_fees' and operation='UPDATE')<>1 then
    raise exception 'Payment correction was not audited';
  end if;
  if has_function_privilege('anon','public.save_membership_fees(uuid,date[],date)','EXECUTE') then
    raise exception 'Anonymous payments RPC granted';
  end if;
end $$;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
set local role authenticated;
do $$
begin
  if exists(select 1 from public.membership_fees) or exists(select 1 from public.membership_reminder_pauses) then
    raise exception 'Nontrainer can see fee records';
  end if;
  begin
    perform public.save_membership_fees(gen_random_uuid(),array[date '2026-01-01'],null);
    raise exception 'Nontrainer recorded payment';
  exception when raise_exception then
    if sqlerrm <> 'Pristup je dozvoljen samo aktivnim trenerima.' then raise; end if;
  end;
end $$;
reset role;
rollback;
