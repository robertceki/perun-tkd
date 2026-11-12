-- Parent sets tkd.r1_trainer_uid to the approved existing trainer's auth UID
-- in this connection. Execute the whole script with stop-on-error; all rows roll back.
begin;
set local timezone = 'Pacific/Honolulu';

set local role anon;
do $$
begin
  begin
    perform 1 from public.training_sessions;
    raise exception 'Anonymous attendance read succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_server_time();
    raise exception 'Anonymous RPC succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
set local role authenticated;
do $$
begin
  if exists(select 1 from public.training_sessions) or exists(select 1 from public.session_attendance) then
    raise exception 'Nontrainer attendance rows visible';
  end if;
  begin
    perform public.get_server_time();
    raise exception 'Nontrainer RPC succeeded';
  exception when raise_exception then
    if sqlerrm <> 'Pristup je dozvoljen samo aktivnim trenerima.' then raise; end if;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('tkd.r1_trainer_uid'), true);
set local role authenticated;
do $$
declare
  trainer uuid := tkd_private.current_trainer();
  grp uuid := gen_random_uuid();
  other_grp uuid := gen_random_uuid();
  kid uuid := gen_random_uuid();
  substitute uuid := gen_random_uuid();
  parent_id uuid := gen_random_uuid();
  term uuid := gen_random_uuid();
  invalid_term uuid := gen_random_uuid();
  window_term uuid;
  lead_minutes integer;
  wall_start timestamp;
  window_start timestamptz;
  direct_session public.training_sessions;
  window_session public.training_sessions;
  opening_error constant text := 'Evidencija prisustva se otvara 60 minuta pre zakazanog početka treninga.';
  monday date := date_trunc('week', clock_timestamp() at time zone 'Europe/Belgrade')::date;
  past date := monday - 7;
  future date := monday + 7;
  expected_start timestamptz := (past + time '18:00') at time zone 'Europe/Belgrade';
  first_call timestamptz := clock_timestamp();
  original public.training_sessions;
  reopened public.training_sessions;
  kid_data jsonb;
  term_data jsonb;
  stmt text;
begin
  if timestamp '2026-01-05 18:00' at time zone 'Europe/Belgrade' <> timestamptz '2026-01-05 17:00Z'
     or timestamp '2026-07-06 18:00' at time zone 'Europe/Belgrade' <> timestamptz '2026-07-06 16:00Z'
     or timestamp '2026-03-29 03:00' at time zone 'Europe/Belgrade' <> timestamptz '2026-03-29 01:00Z'
     or timestamp '2026-10-25 03:00' at time zone 'Europe/Belgrade' <> timestamptz '2026-10-25 02:00Z' then
    raise exception 'Unexpected Belgrade UTC mapping';
  end if;
  if public.get_server_time() not between first_call and clock_timestamp() then
    raise exception 'Server RPC time outside observed window';
  end if;

  insert into public.groups(id,name,kind) values (grp,'R1 original group','main'),(other_grp,'R1 other group','main');
  insert into public.contacts(id,first_name,last_name,phone) values (parent_id,'R1','Parent','000');
  kid_data := jsonb_build_object('id',kid,'first_name','Original','last_name','Child','birth_date','2015-01-01',
    'status','active','main_group_id',grp,'address','','belt','','sex','F','member_type','recreational');
  perform public.save_child(kid_data,jsonb_build_array(jsonb_build_object(
    'child_id',kid,'contact_id',parent_id,'relationship','parent','is_primary',true)));
  perform public.save_child(kid_data || jsonb_build_object('id',substitute,'first_name','Substitute'),
    jsonb_build_array(jsonb_build_object('child_id',substitute,'contact_id',parent_id,'relationship','parent','is_primary',true)));

  term_data := jsonb_build_object('id',term,'group_id',grp,'weekday',1,'starts_at','18:00','ends_at','19:00',
    'valid_from',past,'active',true,'created_by',gen_random_uuid(),'created_at','2000-01-01T00:00:00Z');
  perform public.save_term(term_data,jsonb_build_array(
    jsonb_build_object('term_id',term,'child_id',kid,'valid_from',past,'valid_to',past),
    jsonb_build_object('term_id',term,'child_id',kid,'valid_from',future)));
  update public.weekly_terms set created_by=gen_random_uuid(), updated_by=gen_random_uuid(),
    created_at='2000-01-01T00:00:00Z', updated_at='2000-01-01T00:00:00Z' where id=term;
  if not exists(select 1 from public.weekly_terms where id=term and trainer_id=trainer and created_by=trainer
      and updated_by=trainer and created_at between first_call and clock_timestamp()
      and updated_at between first_call and clock_timestamp()) then
    raise exception 'Term creator or timestamp was not derived by server';
  end if;
  begin
    perform public.save_term(term_data || jsonb_build_object('id',invalid_term),
      jsonb_build_array(jsonb_build_object('term_id',invalid_term,'child_id',gen_random_uuid(),'valid_from',future)));
    raise exception 'Invalid term aggregate save succeeded';
  exception when raise_exception then
    if sqlerrm <> 'Dete ne postoji.' then raise; end if;
  end;
  if exists(select 1 from public.weekly_terms where id=invalid_term) then raise exception 'Partial term save'; end if;

  foreach stmt in array array[
    format('select public.ensure_session(%L,%L)',future,term),
    format('insert into public.training_sessions(term_id,session_date,starts_at_utc) values (%L,%L,%L)',term,future,expected_start)
  ] loop
    begin
      execute stmt;
      raise exception 'Future session write succeeded';
    exception when raise_exception then
      if sqlerrm <> opening_error then raise; end if;
    end;
  end loop;
  if exists(select 1 from public.training_sessions where term_id=term and session_date=future) then
    raise exception 'Future session persisted';
  end if;

  -- Select representable whole-minute starts from the real server clock.
  -- The range leaves room for midnight and execution time. A repeated hour can
  -- leave no representable pre-start fixture, so choose an ordinary run time if needed.
  foreach lead_minutes in array array[90, 20, 30] loop
    window_term := gen_random_uuid();
    select candidate, candidate at time zone 'Europe/Belgrade' into strict window_start, wall_start
    from generate_series(date_trunc('minute', clock_timestamp()) + make_interval(mins => lead_minutes),
                         date_trunc('minute', clock_timestamp()) + make_interval(mins => case when lead_minutes = 90 then 160 else 59 end),
                         interval '1 minute') as g(candidate)
    where ((candidate at time zone 'Europe/Belgrade') at time zone 'Europe/Belgrade') = candidate
      and (candidate at time zone 'Europe/Belgrade')::time < time '23:59'
    order by candidate limit 1;

    perform public.save_term(term_data || jsonb_build_object(
      'id',window_term,'weekday',extract(isodow from wall_start)::integer,'starts_at',to_char(wall_start,'HH24:MI'),
      'ends_at',to_char(wall_start + interval '1 minute','HH24:MI'),'valid_from',wall_start::date),
      jsonb_build_array(jsonb_build_object('term_id',window_term,'child_id',substitute,'valid_from',wall_start::date)));

    if lead_minutes = 90 then
      foreach stmt in array array[
        format('select public.ensure_session(%L,%L)',wall_start::date,window_term),
        format('insert into public.training_sessions(term_id,session_date,starts_at_utc) values (%L,%L,%L)',
          window_term,wall_start::date,clock_timestamp() - interval '1 day')
      ] loop
        begin
          execute stmt;
          raise exception 'Pre-opening session creation succeeded';
        exception when raise_exception then
          if sqlerrm <> opening_error then raise; end if;
        end;
      end loop;
      if exists(select 1 from public.training_sessions where term_id=window_term) then
        raise exception 'Pre-opening session persisted';
      end if;
    elsif lead_minutes = 20 then
      window_session := public.ensure_session(wall_start::date,window_term);
      if window_session.starts_at_utc is distinct from window_start
         or window_session.created_at < window_start - interval '60 minutes'
         or window_session.created_at >= window_start
         or window_session.created_by is distinct from trainer then
        raise exception 'RPC did not create an audited session inside the opening window';
      end if;

      perform public.set_presence(window_session.id,substitute,true);
      perform public.add_substitute(window_session.id,kid);
      update public.session_attendance set present=true, updated_by=gen_random_uuid(),
        updated_at='2000-01-01T00:00:00Z' where session_id=window_session.id and child_id=kid;
      perform public.complete_session(window_session.id);
      if (select count(*) from public.session_attendance where session_id=window_session.id and present
          and updated_by=trainer and updated_at between window_session.created_at and clock_timestamp()) <> 2
         or not exists(select 1 from public.training_sessions where id=window_session.id
          and completed_at between window_session.created_at and clock_timestamp() and completed_at < window_start) then
        raise exception 'Pre-start attendance writes or trusted timestamps failed';
      end if;

      foreach stmt in array array[
        format('select public.cancel_session(%L)',window_session.id),
        format('update public.training_sessions set cancelled_at=clock_timestamp() where id=%L',window_session.id)
      ] loop
        begin
          execute stmt;
          raise exception 'Cancellation before actual start succeeded';
        exception when raise_exception then
          if sqlerrm <> 'Trening još nije počeo.' then raise; end if;
        end;
      end loop;
      if exists(select 1 from public.training_sessions where id=window_session.id and cancelled_at is not null) then
        raise exception 'Denied cancellation persisted';
      end if;
    else
      insert into public.training_sessions(term_id,session_date,starts_at_utc)
        values(window_term,wall_start::date,clock_timestamp() - interval '1 day') returning * into direct_session;
      if direct_session.starts_at_utc is distinct from window_start
         or direct_session.created_at < window_start - interval '60 minutes'
         or direct_session.created_at >= window_start
         or not exists(select 1 from public.session_attendance where session_id=direct_session.id
           and child_id=substitute and not present and not is_substitute) then
        raise exception 'Direct insert did not create the expected pre-start snapshot';
      end if;
    end if;
  end loop;
  perform set_config('tkd.r1_window_session',window_session.id::text,true);

  original := public.ensure_session(past,term);
  if original.starts_at_utc is distinct from expected_start or original.created_by is distinct from trainer then
    raise exception 'Incorrect stored start or creator';
  end if;
  if not exists(select 1 from public.session_attendance where session_id=original.id and child_id=kid and not present and not is_substitute) then
    raise exception 'Default roster row is missing or incorrect';
  end if;
  update public.groups set name='R1 renamed group' where id=grp;
  update public.children set first_name='Renamed' where id=kid;
  reopened := public.ensure_session(past,term);
  if reopened is distinct from original or not exists(select 1 from public.session_attendance
      where session_id=original.id and child_id=kid and child_first_name='Original') then
    raise exception 'Reopening changed the snapshot';
  end if;
  begin
    update public.session_attendance set child_first_name='Forged' where session_id=original.id and child_id=kid;
    raise exception 'Snapshot update succeeded';
  exception when raise_exception then
    if sqlerrm <> 'Snimak prisustva je nepromenljiv.' then raise; end if;
  end;

  perform public.complete_session(original.id);
  perform public.set_presence(original.id,kid,true);
  perform public.add_substitute(original.id,substitute);
  if not exists(select 1 from public.session_attendance where session_id=original.id and child_id=substitute and not present and is_substitute) then
    raise exception 'Substitute did not default absent';
  end if;
  perform public.set_presence(original.id,substitute,true);
  perform public.add_substitute(original.id,substitute);
  if (select count(*) from public.session_attendance where session_id=original.id) <> 2
     or not exists(select 1 from public.session_attendance where session_id=original.id and child_id=substitute and present)
     or not exists(select 1 from public.training_sessions where id=original.id and completed_at is not null) then
    raise exception 'Completion, late edit or substitute deduplication failed';
  end if;

  perform public.cancel_session(original.id);
  foreach stmt in array array[
    format('select public.set_presence(%L,%L,false)',original.id,kid),
    format('select public.add_substitute(%L,%L)',original.id,substitute),
    format('select public.complete_session(%L)',original.id),
    format('update public.session_attendance set present=false where session_id=%L and child_id=%L',original.id,kid)
  ] loop
    begin
      execute stmt;
      raise exception 'Cancelled session write succeeded';
    exception when raise_exception then
      if sqlerrm <> 'Otkazan trening je zaključan.' then raise; end if;
    end;
  end loop;

  begin
    update public.children set status='inactive', main_group_id=other_grp where id=kid;
    raise exception 'Live future enrollment did not block deactivation/move';
  exception when raise_exception then
    if sqlerrm <> 'Najpre završite postojeće upise deteta.' then raise; end if;
  end;
  perform public.cancel_enrollment(term,kid,future);
  update public.children set status='inactive', main_group_id=other_grp where id=kid;
  if not exists(select 1 from public.term_assignments where term_id=term and child_id=kid and valid_from=future and valid_to is null and cancelled_at between first_call and clock_timestamp())
     or not exists(select 1 from public.term_assignments where term_id=term and child_id=kid and valid_from=past and valid_to=past)
     or not exists(select 1 from public.session_attendance where session_id=original.id and child_id=kid and present)
     or not exists(select 1 from public.children where id=kid and status='inactive' and main_group_id=other_grp) then
    raise exception 'Enrollment cancellation changed history or blocked child update';
  end if;
  begin
    perform 1 from tkd_private.attendance_audit;
    raise exception 'Trainer can read private audit';
  exception when insufficient_privilege then null;
  end;
  perform set_config('tkd.r1_session',original.id::text,true);
end $$;
reset role;

do $$
declare
  session_id uuid := current_setting('tkd.r1_session')::uuid;
  window_id uuid := current_setting('tkd.r1_window_session')::uuid;
  start_at timestamptz := timestamptz '2026-07-06 16:00Z';
  opens_at timestamptz := start_at - interval '60 minutes';
begin
  if not exists(select 1 from tkd_private.attendance_audit a
      join public.training_sessions s on s.id=session_id
      where a.entity='training_sessions' and a.after_row->>'id'=session_id::text
        and a.actor_id=s.created_by and a.happened_at >= s.created_at
        and a.before_row->>'cancelled_at' is null and a.after_row->>'cancelled_at' is not null) then
    raise exception 'Missing trusted cancellation audit';
  end if;

  if not exists(select 1 from tkd_private.attendance_audit a
      join public.training_sessions s on s.id=window_id
      where a.entity='session_attendance' and a.after_row->>'session_id'=window_id::text
        and a.actor_id=s.created_by and a.happened_at >= s.created_at and a.happened_at < s.starts_at_utc
        and a.before_row->>'present'='false' and a.after_row->>'present'='true') then
    raise exception 'Missing trusted pre-start attendance audit';
  end if;

  -- Deterministic exact-cutoff coverage is split between the browser mock and
  -- these predicate checks. The live SQL cases exercise either side with margin.
  if not (opens_at - interval '1 minute' < opens_at)
     or opens_at < opens_at or opens_at + interval '1 minute' < opens_at
     or position('clock_timestamp() < starts_at_utc - interval ''60 minutes''' in pg_get_functiondef('public.ensure_session(date,uuid)'::regprocedure))=0
     or position('clock_timestamp() < new.starts_at_utc - interval ''60 minutes''' in pg_get_functiondef('tkd_private.check_session()'::regprocedure))=0
     or position('clock_timestamp() < s.starts_at_utc - interval ''60 minutes''' in pg_get_functiondef('tkd_private.check_attendance()'::regprocedure))=0
     or position('clock_timestamp() < old.starts_at_utc - interval ''60 minutes''' in pg_get_functiondef('tkd_private.check_session()'::regprocedure))=0
     or position('clock_timestamp() < old.starts_at_utc then' in pg_get_functiondef('tkd_private.check_session()'::regprocedure))=0
     or position('clock_timestamp()<s.starts_at_utc' in pg_get_functiondef('public.cancel_session(uuid)'::regprocedure))=0 then
    raise exception 'Expected inclusive opening and actual-start cancellation guards';
  end if;
end $$;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
set local role authenticated;
do $$
declare
  sid uuid := current_setting('tkd.r1_session')::uuid;
  window_id uuid := current_setting('tkd.r1_window_session')::uuid;
begin
  if exists(select 1 from public.training_sessions where id in (sid,window_id))
     or exists(select 1 from public.session_attendance where session_id in (sid,window_id)) then
    raise exception 'Nontrainer can see seeded session or roster';
  end if;
  begin
    update public.session_attendance set present=false where session_id=window_id;
    raise exception 'Nontrainer UPDATE succeeded';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Pristup je dozvoljen samo aktivnim trenerima.' then raise; end if;
  end;
  begin
    perform public.complete_session(window_id);
    raise exception 'Nontrainer completed seeded session';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Pristup je dozvoljen samo aktivnim trenerima.' then raise; end if;
  end;
end $$;
reset role;
rollback;



