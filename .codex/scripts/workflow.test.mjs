import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { snapshot, changes, validateRequest, claimRequest, beginReview, makeReview, reviewCurrent } from './workflow.mjs';

mkdirSync('.tmnt/runs',{recursive:true});
const root=mkdtempSync(resolve('.tmnt/runs/control-test-'));
mkdirSync(resolve(root,'src')); writeFileSync(resolve(root,'src/a.ts'),'bug');
const goal={revision:'S1',status:'approved',approvalEvidence:'explicit fixture approval'};
const task={id:'D1',role:'donatello',specRevision:'S1',status:'open',retryUsed:0,lastAttempt:null,allowedFiles:['src/a.ts'],dod:['behavior passes'],reviewFiles:['src/a.ts'],manualCriteria:[]};
const request={requestId:'request-1',task:'D1',role:'donatello',phase:'initial',repository:root,specRevision:'S1',approvalEvidence:goal.approvalEvidence,allowedFiles:task.allowedFiles,dod:task.dod,prompt:'bounded fixture'};
test('approved scope and initial task required',()=>{
  validateRequest(root,request,goal,task);
  assert.throws(()=>validateRequest(root,request,{...goal,status:'pending'},task));
  assert.throws(()=>validateRequest(root,{...request,allowedFiles:['src/b.ts']},goal,task));
  assert.throws(()=>validateRequest(root,{...request,dod:['different']},goal,task));
  assert.throws(()=>validateRequest(root,request,goal,{...task,status:'awaiting_worker'}));
});
test('protected/traversal outputs rejected',()=>{
  for(const p of ['../escape','.env','.ENV','.env.local','.git/config','.GIT/config','.CODEX/agents/a.toml','AGENTS.MD','.env.','src/aux.ts','src/a.ts ','.tmnt/goal.json','.codex/agents/a.toml','node_modules/a','C:/escape']) {
    assert.throws(()=>validateRequest(root,{...request,allowedFiles:[p]},goal,{...task,allowedFiles:[p]}));
  }
});
test('claimed requests cannot replay after restart or payload change',()=>{
  const bytes=Buffer.from(JSON.stringify(request));
  claimRequest(root,request,bytes);
  assert.throws(()=>claimRequest(root,request,bytes));
  assert.throws(()=>claimRequest(root,request,Buffer.from('changed')));
});
test('detect edits to existing dirty files, untracked additions and deletions',()=>{
  const before=snapshot(root);
  writeFileSync(resolve(root,'src/a.ts'),'changed');
  writeFileSync(resolve(root,'outside.txt'),'unapproved');
  const diff=changes(before,snapshot(root));
  assert.deepEqual(diff,['outside.txt','src/a.ts']);
  assert.deepEqual(diff.filter(p=>!task.allowedFiles.includes(p)),['outside.txt']);
  assert.deepEqual(changes({'deleted':'hash'},{}),['deleted']);
});
test('one correction and independent re-review; later edit invalidates QA',()=>{
  const check=passed=>[{command:'fixture behavior check',exitCode:passed?0:1,passed,evidence:'fixture assertion result'}];
  const initial=makeReview(root,task,'S1',check(false),[],beginReview(root,task,'S1'));
  assert.equal(reviewCurrent(root,task,goal,initial),false);
  const failed={...task,status:'failed',lastAttempt:{requestId:'request-1'}};
  validateRequest(root,{...request,requestId:'correction-1',phase:'correction'},goal,failed);
  writeFileSync(resolve(root,'src/a.ts'),'fixed');
  const correction={...failed,retryUsed:1};
  const reviewed=makeReview(root,correction,'S1',check(true),[],beginReview(root,correction,'S1'));
  assert.equal(reviewCurrent(root,correction,goal,reviewed),true);
  assert.throws(()=>validateRequest(root,{...request,phase:'correction'},goal,correction));
  writeFileSync(resolve(root,'src/a.ts'),'later edit');
  assert.equal(reviewCurrent(root,correction,goal,reviewed),false);
  assert.equal(reviewCurrent(root,correction,{...goal,revision:'S2'},reviewed),false);
});
test('manual checks cannot disappear; explicit deferral remains disclosed',()=>{
  const manualTask={...task,manualCriteria:['browser check']};
  const checks=[{command:'fixture',exitCode:0,passed:true,evidence:'fixture result'}];
  const begun=beginReview(root,manualTask,'S1');
  assert.throws(()=>makeReview(root,manualTask,'S1',checks,[],begun));
  const review=makeReview(root,manualTask,'S1',checks,[{criterion:'browser check',status:'pending',evidence:'not performed'}],begun);
  assert.equal(reviewCurrent(root,manualTask,goal,review),false);
  const deferred=makeReview(root,manualTask,'S1',checks,[{criterion:'browser check',status:'deferred',evidence:'fixture user explicitly deferred'}],begun);
  assert.equal(deferred.manual[0].status,'deferred');
  assert.equal(reviewCurrent(root,manualTask,goal,deferred),true);
});
test('edits during verification cannot be stamped as tested',()=>{
  const begun=beginReview(root,task,'S1');
  writeFileSync(resolve(root,'src/a.ts'),'changed while tests ran');
  assert.throws(()=>makeReview(root,task,'S1',[{command:'test',exitCode:0,passed:true,evidence:'old result'}],[],begun),/state changed/);
});
test('protected snapshot retains Git and existing evidence',()=>{
  mkdirSync(resolve(root,'.git')); writeFileSync(resolve(root,'.git/HEAD'),'before');
  writeFileSync(resolve(root,'.tmnt/runs/old-report.json'),'before');
  const before=snapshot(root,true);
  writeFileSync(resolve(root,'.git/HEAD'),'after');
  writeFileSync(resolve(root,'.tmnt/runs/old-report.json'),'after');
  assert.deepEqual(changes(before,snapshot(root,true)),['.git/HEAD','.tmnt/runs/old-report.json']);
});
