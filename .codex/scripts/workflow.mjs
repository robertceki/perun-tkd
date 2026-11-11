import { createHash } from 'node:crypto';
import { readFileSync, readlinkSync, readdirSync, lstatSync, realpathSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const excluded = path => { const p=path.toLowerCase(); return ['.git', 'node_modules', 'dist', 'build'].includes(p.split('/')[0]) || p === '.tmnt/runs' || p.startsWith('.tmnt/runs/'); };
export function exactPath(root, path) {
  if (typeof path !== 'string' || !path || /[\\:<>"|?*\x00-\x1f]/.test(path) || isAbsolute(path) || path.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw Error('Invalid relative path');
  const absolute = resolve(root, path);
  let current = root;
  for (const part of path.split('/')) {
    current = resolve(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw Error('Linked path is not allowed');
  }
  return absolute;
}
export function snapshot(root, protectedOnly = false) {
  root = realpathSync(root);
  const files = {};
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name), path = relative(root, full).split(sep).join('/');
      if (!protectedOnly && excluded(path)) continue;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) { files[path] = `LINK:${readlinkSync(full)}`; continue; }
      if (stat.isDirectory()) visit(full);
      else if (stat.isFile()) files[path] = hash(readFileSync(full));
      else throw Error('Unsupported filesystem entry');
    }
  }
  if (protectedOnly) {
    for (const p of ['.git','.tmnt/runs']) {
      const full=resolve(root,p);
      if (existsSync(full)) {
        if (lstatSync(full).isDirectory()) visit(full);
        else files[p]=hash(readFileSync(full));
      }
    }
  } else visit(root);
  return files;
}
export function changes(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]).sort();
}
export function fingerprint(root, paths) {
  if (!Array.isArray(paths) || !paths.length || new Set(paths).size !== paths.length) throw Error('Review files required and unique');
  return hash(JSON.stringify([...paths].sort().map(p => {
    const full = exactPath(root, p);
    return [p, existsSync(full) ? hash(readFileSync(full)) : null];
  })));
}
const writable = path => { const p=path.toLowerCase(); return !excluded(p) && !['.tmnt','.codex','.agents'].some(x=>p===x || p.startsWith(x+'/')) && !['agents.md','.gitignore'].includes(p) && !p.split('/').some(x => x === '.env' || x.startsWith('.env.')); };
export function validateRequest(root, request, goal, task) {
  if (!request || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(request.requestId ?? '')) throw Error('Invalid request ID');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(request.task ?? '')) throw Error('Invalid task ID');
  if (realpathSync(request.repository) !== realpathSync(root)) throw Error('Repository mismatch');
  if (!['donatello','michelangelo','raphael'].includes(request.role) || task.role !== request.role || task.id !== request.task) throw Error('Role/task mismatch');
  if (goal.status !== 'approved' || !goal.approvalEvidence || request.approvalEvidence !== goal.approvalEvidence || request.specRevision !== goal.revision || task.specRevision !== goal.revision) throw Error('SPEC approval mismatch');
  if (!Array.isArray(task.allowedFiles) || !task.allowedFiles.length || new Set(task.allowedFiles).size !== task.allowedFiles.length || JSON.stringify(request.allowedFiles) !== JSON.stringify(task.allowedFiles)) throw Error('Allowed files mismatch');
  for (const p of task.allowedFiles) { exactPath(root,p); if (!writable(p)) throw Error('Protected output path'); }
  if (!Array.isArray(task.dod) || !task.dod.length || task.dod.some(x => typeof x !== 'string' || !x.trim()) || JSON.stringify(request.dod) !== JSON.stringify(task.dod)) throw Error('DoD mismatch');
  if (typeof request.prompt !== 'string' || !request.prompt.trim()) throw Error('Prompt required');
  if (request.phase === 'initial') {
    if (task.status !== 'open' || task.retryUsed !== 0 || task.lastAttempt != null) throw Error('Initial attempt not available');
  } else if (request.phase === 'correction') {
    if (!['failed','blocked'].includes(task.status) || task.retryUsed !== 0 || !task.lastAttempt) throw Error('Correction budget unavailable');
  } else throw Error('Invalid phase');
}
export function claimRequest(root, request, bytes) {
  const dir = resolve(root, '.tmnt/runs/claims'); mkdirSync(dir, {recursive:true});
  const claim = { requestId:request.requestId, requestHash:hash(bytes), task:request.task, role:request.role, phase:request.phase, state:'claimed', time:new Date().toISOString() };
  // Exclusive creation survives interruption: an uncertain launch cannot be replayed.
  writeFileSync(resolve(dir, `${request.requestId}.json`), JSON.stringify(claim,null,2), {flag:'wx'});
  return claim;
}
export function beginReview(root, task, revision) {
  return { task:task.id, specRevision:revision, paths:[...task.reviewFiles].sort(), fingerprint:fingerprint(root,task.reviewFiles), startedAt:new Date().toISOString() };
}
export function makeReview(root, task, revision, checks, manual = [], begun) {
  if (!begun || begun.task !== task.id || begun.specRevision !== revision || JSON.stringify(begun.paths) !== JSON.stringify([...task.reviewFiles].sort()) || begun.fingerprint !== fingerprint(root,task.reviewFiles)) throw Error('Review state changed or begin-review evidence missing');
  if (!checks?.length || checks.some(c => !c.command || !Number.isInteger(c.exitCode) || typeof c.passed !== 'boolean' || !c.evidence)) throw Error('Actual check evidence required');
  const required = task.manualCriteria ?? [];
  if (manual.length !== required.length || required.some(text => !manual.some(m => m.criterion === text && ['passed','deferred','accepted','pending'].includes(m.status) && m.evidence))) throw Error('Manual criteria/evidence mismatch');
  const paths = task.reviewFiles;
  if (!task.allowedFiles.every(p => paths?.includes(p))) throw Error('Review omits outputs');
  return { ...begun, checks, manual, status:checks.every(c=>c.passed) && manual.every(m=>m.status !== 'pending') ? 'passed' : 'failed', time:new Date().toISOString() };
}
export function reviewCurrent(root, task, goal, review) {
  return goal.status === 'approved' && !!goal.approvalEvidence && task.specRevision === goal.revision && review.task === task.id && review.specRevision === goal.revision && review.status === 'passed' && JSON.stringify(review.paths) === JSON.stringify([...task.reviewFiles].sort()) && review.fingerprint === fingerprint(root,task.reviewFiles) && review.checks?.length > 0 && review.checks.every(c=>c.passed && c.evidence) && (task.manualCriteria ?? []).every(t => review.manual.some(m=>m.criterion===t && ['passed','accepted','deferred'].includes(m.status) && m.evidence));
}
