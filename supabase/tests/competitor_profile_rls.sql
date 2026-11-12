-- Run against a local migrated database as its owner. All fixture writes roll back.
begin;

select set_config('tkd.profile_uid', gen_random_uuid()::text, true);
insert into auth.users(id) values (current_setting('tkd.profile_uid')::uuid);
insert into public.trainers(id, user_id, full_name)
values (gen_random_uuid(), current_setting('tkd.profile_uid')::uuid, 'Synthetic trainer');

set local role anon;
do $$
begin
  begin
    perform 1 from public.weight_categories;
    raise exception 'Anonymous weight read succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
set local role authenticated;
do $$
begin
  if exists(select 1 from public.weight_categories) or exists(select 1 from public.competition_classes) then
    raise exception 'Nontrainer can read catalogs';
  end if;
end $$;

select set_config('request.jwt.claim.sub', current_setting('tkd.profile_uid'), true);
do $$
declare
  kid uuid := gen_random_uuid();
  main uuid := gen_random_uuid();
  competition uuid := gen_random_uuid();
  parent uuid := gen_random_uuid();
  term uuid := gen_random_uuid();
  second_term uuid := gen_random_uuid();
  trainer uuid;
  today date := (statement_timestamp() at time zone 'Europe/Belgrade')::date;
  starts date := today - 14;
  draft jsonb;
  links jsonb;
  female_weight text;
  male_weight text;
  older_weight text;
  expected record;
begin
  select id into strict trainer from public.trainers where user_id = auth.uid();
  if (select array_agg(id order by id) from public.competition_classes) is distinct from array['A','B'] then
    raise exception 'Unexpected competition classes';
  end if;
  if (select count(*) from public.weight_categories) <> 124 then
    raise exception 'Unexpected weight catalog size';
  end if;
  for expected in
    select age, sex, weights from (values
      ('rev_pioneers', array['M','F'], array[-19,-21,-23,-25,-27,-29,-31,-33,-36,-39,-43,43]),
      ('younger_pioneers', array['M','F'], array[-19,-21,-23,-25,-27,-29,-31,-33,-36,-39,-43,43]),
      ('older_pioneers', array['M','F'], array[-27,-30,-33,-36,-40,-44,-48,-52,-57,57]),
      ('cadets', array['M'], array[-33,-37,-41,-45,-49,-53,-57,-61,-65,65]),
      ('cadets', array['F'], array[-29,-33,-37,-41,-44,-47,-51,-55,-59,59]),
      ('juniors', array['M'], array[-45,-48,-51,-55,-59,-63,-68,-73,-78,78]),
      ('juniors', array['F'], array[-42,-44,-46,-49,-52,-55,-59,-63,-68,68]),
      ('seniors', array['M'], array[-54,-58,-63,-68,-74,-80,-87,87]),
      ('seniors', array['F'], array[-46,-49,-53,-57,-62,-67,-73,73])
    ) as catalog(age, sexes, weights) cross join lateral unnest(sexes) as s(sex)
  loop
    if (select array_agg(w.signed_kg order by w.sort_order) from public.weight_categories w
        where w.age_category = expected.age and w.sex = expected.sex) is distinct from expected.weights then
      raise exception 'Unexpected weights for % / %', expected.age, expected.sex;
    end if;
  end loop;
  begin
    update public.weight_categories set sort_order = 1;
    raise exception 'Trainer weight write succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.competition_classes;
    raise exception 'Trainer class write succeeded';
  exception when insufficient_privilege then null;
  end;

  select id into strict female_weight from public.weight_categories where age_category='cadets' and sex='F' and signed_kg=-29;
  select id into strict male_weight from public.weight_categories where age_category='cadets' and sex='M' and signed_kg=-33;
  select id into strict older_weight from public.weight_categories where age_category='older_pioneers' and sex='F' and signed_kg=-27;
  insert into public.groups(id,name,kind) values (main,'Synthetic main','main'), (competition,'Synthetic competition','competition');
  insert into public.contacts(id,first_name,last_name,phone) values (parent,'Synthetic','Parent','000');
  draft := jsonb_build_object('id',kid,'first_name','Synthetic','last_name','Child',
    'birth_date',make_date(extract(year from today)::int-12,12,31),'status','active',
    'main_group_id',main,'competition_group_id',competition,'address','','belt','','member_type','competitor');
  links := jsonb_build_array(jsonb_build_object('child_id',kid,'contact_id',parent,'relationship','parent','is_primary',true));
  begin
    perform public.save_child(draft,links);
    raise exception 'New child without sex accepted';
  exception when raise_exception then
    if sqlerrm <> 'Pol je obavezan za novo dete.' then raise; end if;
  end;
  perform public.save_child(draft || '{"sex":"F"}',links);
  if not exists(select 1 from public.children where id=kid and competition_class is null and weight_category_id is null) then
    raise exception 'Optional fields were not left empty';
  end if;
  begin
    perform public.save_child(jsonb_build_object('id',kid,'weight_category_id',male_weight),links);
    raise exception 'Wrong-sex weight accepted';
  exception when raise_exception then
    if sqlerrm <> 'Težinska kategorija ne odgovara polu i uzrastu deteta.' then raise; end if;
  end;
  begin
    perform public.save_child(jsonb_build_object('id',kid,'weight_category_id',older_weight),links);
    raise exception 'Wrong-age weight accepted';
  exception when raise_exception then
    if sqlerrm <> 'Težinska kategorija ne odgovara polu i uzrastu deteta.' then raise; end if;
  end;
  perform public.save_child(jsonb_build_object('id',kid,'competition_class','A','weight_category_id',female_weight),links);
  if not exists(select 1 from public.children where id=kid and competition_class='A' and weight_category_id=female_weight) then
    raise exception 'Competitor profile did not persist';
  end if;

  insert into public.weekly_terms(id,group_id,weekday,starts_at,ends_at,trainer_id,valid_from)
  values (term,competition,extract(isodow from starts)::int,'09:00','10:00',trainer,starts),
         (second_term,competition,extract(isodow from starts)::int,'11:00','12:00',trainer,starts);
  insert into public.term_assignments(term_id,child_id,valid_from) values (term,kid,starts);
  perform public.ensure_session(starts,term);
  begin
    perform public.save_child(jsonb_build_object('id',kid,'member_type','recreational',
      'competition_group_id',null,'competition_class',null,'weight_category_id',null),links);
    raise exception 'Removed competition group with a live assignment';
  exception when raise_exception then
    if sqlerrm <> 'Najpre završite postojeće upise deteta.' then raise; end if;
  end;

  begin
    update public.children set member_type='recreational', competition_class=null, weight_category_id=null where id=kid;
    raise exception 'Direct downgrade with unchanged competition group accepted';
  exception when raise_exception then
    if sqlerrm <> 'Takmičarska grupa zahteva takmičara.' then raise; end if;
  end;

  -- Seed the post-backfill fixture as owner, preserving the original enrollment and roster.
  set constraints all immediate;
  reset role;
  alter table public.children disable trigger check_child;
  update public.children set member_type='recreational', sex=null, competition_class=null, weight_category_id=null where id=kid;
  alter table public.children enable trigger check_child;
  set local role authenticated;
  set constraints all deferred;
  perform public.save_child(jsonb_build_object('id',kid,'notes','Legacy profile edit'),links);
  if not exists(select 1 from public.children where id=kid and sex is null and member_type='recreational'
      and competition_group_id=competition and notes='Legacy profile edit') then
    raise exception 'Legacy profile edit did not preserve its group and missing sex';
  end if;
  begin
    insert into public.term_assignments(term_id,child_id,valid_from) values (second_term,kid,today);
    raise exception 'New recreational competition enrollment accepted';
  exception when raise_exception then
    if sqlerrm <> 'Upis u takmičarski termin zahteva takmičara.' then raise; end if;
  end;
  update public.term_assignments set valid_to=today-1 where term_id=term and child_id=kid;
  perform public.save_child(jsonb_build_object('id',kid,'competition_group_id',null),links);
  if not exists(select 1 from public.term_assignments where term_id=term and child_id=kid and valid_to=today-1)
     or not exists(select 1 from public.session_attendance a join public.training_sessions s on s.id=a.session_id
       where s.term_id=term and s.session_date=starts and a.child_id=kid and not a.is_substitute) then
    raise exception 'Historical enrollment or roster was lost';
  end if;
  set constraints all immediate;
end $$;
rollback;

