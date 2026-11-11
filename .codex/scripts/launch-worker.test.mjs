import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source=dirname(fileURLToPath(import.meta.url));
mkdirSync('.tmnt/runs',{recursive:true});
function fixture(mode) {
  const root=mkdtempSync(resolve('.tmnt/runs/launcher-test-'));
  for(const dir of ['src','.git','.codex/scripts','.tmnt/tasks','.tmnt/runs']) mkdirSync(resolve(root,dir),{recursive:true});
  for(const name of ['run-worker.mjs','launch-worker.mjs','workflow.mjs']) copyFileSync(resolve(source,name),resolve(root,'.codex/scripts',name));
  writeFileSync(resolve(root,'src/a.ts'),'initial local work');
  writeFileSync(resolve(root,'.git/HEAD'),'fixture metadata');
  writeFileSync(resolve(root,'.tmnt/runs/prior.json'),'prior evidence');
  writeFileSync(resolve(root,'exec'),`
import {writeFileSync} from 'node:fs';
let input=''; for await(const chunk of process.stdin) input+=chunk;
const args=process.argv.slice(2), output=args[args.indexOf('--output-last-message')+1];
writeFileSync('src/a.ts','worker change');
if(${JSON.stringify(mode)}==='scope')writeFileSync('outside.txt','unexpected');
if(${JSON.stringify(mode)}==='evidence')writeFileSync('.tmnt/runs/prior.json','tampered');
if(${JSON.stringify(mode)}==='git')writeFileSync('.git/HEAD','tampered');
writeFileSync(output,${JSON.stringify(mode==='question'?'QUESTION: decision needed':'DONE')});
process.exitCode=${mode==='crash'?7:0};
`);
  const goal={revision:'S1',status:'approved',approvalEvidence:'fixture approval'};
  const task={id:'D1',role:'donatello',specRevision:'S1',status:'open',retryUsed:0,lastAttempt:null,allowedFiles:['src/a.ts'],dod:['fixture criterion'],reviewFiles:['src/a.ts'],manualCriteria:[]};
  const request={requestId:'initial',role:'donatello',task:'D1',phase:'initial',repository:root,specRevision:'S1',approvalEvidence:goal.approvalEvidence,allowedFiles:task.allowedFiles,dod:task.dod,prompt:'Change only src/a.ts in this isolated fake fixture. DONE.'};
  for(const [name,value] of [['.tmnt/goal.json',goal],['.tmnt/tasks/D1.json',task],['.tmnt/runs/request.json',request]]) writeFileSync(resolve(root,name),JSON.stringify(value));
  const launch=()=>spawnSync(process.execPath,[resolve(root,'.codex/scripts/launch-worker.mjs'),'--request',resolve(root,'.tmnt/runs/request.json'),'--cli',process.execPath],{cwd:root,encoding:'utf8',windowsHide:true,timeout:20000});
  return {root,launch};
}
for(const mode of ['done','question','crash','scope','evidence','git']) {
  test(`real launcher integration: ${mode}`,()=>{
    const {root,launch}=fixture(mode), result=launch();
    assert.ok(result.stdout.trim(),result.stderr);
    const report=JSON.parse(result.stdout);
    assert.equal(report.workerExitCode,mode==='crash'?7:0);
    assert.equal(report.status,mode==='done'?'verify':mode==='question'?'blocked: question':mode==='crash'?'failed':'blocked: scope');
    assert.ok(report.changedFiles.includes('src/a.ts'));
    if(mode==='scope') assert.ok(report.unexpectedFiles.includes('outside.txt'));
    if(mode==='evidence') assert.ok(report.unexpectedFiles.includes('.tmnt/runs/prior.json'));
    if(mode==='git') assert.ok(report.unexpectedFiles.includes('.git/HEAD'));
    const ledger=JSON.parse(readFileSync(resolve(root,'.tmnt/tasks/D1.json'),'utf8'));
    assert.equal(ledger.status,mode==='done'?'awaiting_review':mode==='crash'?'failed':'blocked');
    const replay=launch();
    assert.notEqual(replay.status,0);
    assert.match(replay.stderr,/Initial attempt not available|EEXIST/);
  });
}
