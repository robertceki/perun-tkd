import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runWorker } from './run-worker.mjs';
mkdirSync('.tmnt/runs', { recursive: true });
const testDir = mkdtempSync(resolve('.tmnt/runs/transport-test-'));
const fixture = resolve(testDir, 'fake-cli.mjs');
writeFileSync(fixture, `
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
let input=''; process.stdin.setEncoding('utf8'); for await (const c of process.stdin) input+=c;
const spec=JSON.parse(input.slice(input.lastIndexOf('\\nSPEC:')+6));
const a=process.argv.slice(2); const out=a[a.indexOf('--output-last-message')+1];
writeFileSync(out+'.input.json',JSON.stringify({input,args:a}));
console.log(JSON.stringify({type:'diagnostic',text:'DONE'}));
console.error('stderr captured');
if(spec.hang){const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',process.stdout,process.stderr],windowsHide:true});writeFileSync(out+'.pid',String(descendant.pid));}
if(spec.partial) writeFileSync(out+'.partial','partial evidence');
if(spec.answer!==undefined) writeFileSync(out,spec.answer);
if(spec.hang) setInterval(()=>{},1000); else process.exitCode=spec.code||0;
`);
const cases = [
  ['done', {answer:'Verified transport\nDONE'}, 'verify'],
  ['question', {answer:'Preserve this context\nQUESTION: approval needed?'}, 'blocked: question'],
  ['failure', {answer:'DONE',code:7}, 'failed'],
  ['missing', {answer:'No final marker'}, 'failed'],
  ['absent', {}, 'failed'],
  ['timeout', {answer:'DONE',hang:true,partial:true}, 'failed'],
];
for (const [name,spec,expected] of cases) {
 const literal = '\u010d\u0107\u017e\u0161\u0111 čćžšđ "quotes" `backticks` $HOME $(must-not-run)\nsecond line';
 const r = await runWorker({cli:process.execPath,prefix:[fixture],task:`test-${name}`,
   role:'donatello',sandbox:'read-only',timeoutMs:spec.hang?1500:10000,prompt:`${literal}\nSPEC:${JSON.stringify(spec)}`});
 assert.equal(r.status, expected, name);
 const captured=JSON.parse(readFileSync(r.finalPath+'.input.json','utf8'));
 assert.ok(captured.input.includes(literal),'literal UTF-8 prompt');
 assert.ok(captured.input.includes('Do not restart Splinter/Leonardo'),'inner boundary');
 assert.ok(captured.args.includes('read-only'),'sandbox preserved');
 assert.equal(captured.args.at(-1),'-','stdin prompt transport');
 assert.ok(readFileSync(r.stderrPath,'utf8').includes('stderr captured'));
 if(name==='question')assert.equal(r.response,spec.answer);
 if(spec.hang){const pid=Number(readFileSync(r.finalPath+'.pid','utf8'));assert.throws(()=>process.kill(pid,0),'descendant must be terminated');}
 if(name==='failure')assert.equal(r.workerExitCode,7);
 if(spec.hang){assert.equal(r.timedOut,true);assert.ok(existsSync(r.finalPath+'.partial'));}
 console.log(JSON.stringify({case:name,status:r.status,exit:r.workerExitCode,timedOut:r.timedOut,runDir:r.runDir}));
}
const launchFailure=await runWorker({cli:fixture,task:'test-launch-error',role:'donatello',prompt:'no edit',timeoutMs:10000});
assert.equal(launchFailure.status,'failed');
assert.notEqual(launchFailure.status,'verify');
await assert.rejects(runWorker({cli:process.execPath,task:'../escape',role:'donatello',prompt:'no edit'}));
await assert.rejects(runWorker({cli:process.execPath,task:'invalid-timeout',role:'donatello',prompt:'no edit',timeoutMs:2147478648}), /Invalid timeout/);
console.log('TRANSPORT_TESTS_OK: 6 process outcomes, launch failure, invalid task ID');
