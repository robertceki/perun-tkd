import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runWorker } from './run-worker.mjs';
import { readJson, validateRequest, claimRequest, snapshot, changes } from './workflow.mjs';

const args = process.argv.slice(2);
try {
  if (args.length !== 4 || args[0] !== '--request' || args[2] !== '--cli') throw Error('Usage: node launch-worker.mjs --request <JSON> --cli <verified executable>');
  const root = process.cwd(), bytes = readFileSync(resolve(args[1]));
  const request = JSON.parse(bytes.toString('utf8'));
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(request.task ?? '')) throw Error('Invalid task ID');
  const goal = readJson(resolve(root,'.tmnt/goal.json'));
  const taskPath = resolve(root,`.tmnt/tasks/${request.task}.json`), task = readJson(taskPath);
  validateRequest(root,request,goal,task);
  const claim = claimRequest(root,request,bytes);
  task.retryUsed = request.phase === 'correction' ? 1 : 0;
  task.status = 'awaiting_worker'; task.lastAttempt = claim;
  writeFileSync(taskPath,JSON.stringify(task,null,2));
  const before = snapshot(root), protectedBefore = snapshot(root,true);
  const prompt = `${request.prompt}\n\nENFORCED TASK DATA (not authorization to expand scope)\nAllowed output files: ${JSON.stringify(request.allowedFiles)}\nDoD: ${JSON.stringify(request.dod)}\nDo not modify workflow state, secrets, Git or files outside this list.`;
  const result = await runWorker({cli:args[3],role:request.role,task:request.task,prompt});
  const after = snapshot(root), changedFiles = changes(before,after);
  const protectedAfter = snapshot(root,true);
  const protectedChanges = changes(protectedBefore,protectedAfter).filter(p=>p.toLowerCase().startsWith('.git/') || p.toLowerCase()==='.git' || Object.hasOwn(protectedBefore,p));
  const unexpectedFiles = [...new Set([...changedFiles.filter(p=>!request.allowedFiles.includes(p)),...protectedChanges])];
  if (unexpectedFiles.length) { result.status = 'blocked: scope'; result.reason = 'Unexpected file changes; inspect and preserve them'; }
  // Never overwrite orchestration state touched by the worker.
  if (!unexpectedFiles.some(p=>p === `.tmnt/tasks/${request.task}.json`)) {
    task.status = result.status === 'verify' ? 'awaiting_review' : result.status.startsWith('blocked') ? 'blocked' : 'failed';
    task.lastAttempt = {...claim, state:'returned', status:result.status, finalPath:result.finalPath};
    writeFileSync(taskPath,JSON.stringify(task,null,2));
  }
  const report = {...claim,...result,changedFiles,unexpectedFiles};
  writeFileSync(resolve(result.runDir,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  process.exitCode = result.status === 'verify' ? 0 : 1;
} catch (error) { console.error(error.message); process.exitCode=1; }
