import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const workerBoundary = `You are an inner implementation worker for a bounded TKD Perun task.
Execute only the supplied task and DoD. Do not restart Splinter/Leonardo, delegate,
invoke codex recursively, update orchestration state or role memory, commit, push,
or switch branches. If approval or clarification is required, return QUESTION: and stop.
Do not expand file scope. End your final response with DONE or QUESTION: <text>.`;

export async function runWorker({ cli, prompt, role, task, sandbox = 'workspace-write',
  timeoutMs = 900000, prefix = [] }) {
  const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  if (realpathSync(process.cwd()) !== root) throw new Error('Run from the TKD repository root');
  if (!['donatello', 'michelangelo', 'raphael'].includes(role)) throw new Error('Invalid specialist');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(task)) throw new Error('Invalid task ID');
  if (!['read-only', 'workspace-write'].includes(sandbox)) throw new Error('Invalid sandbox');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147478647) throw new Error('Invalid timeout');
  if (!prompt?.trim()) throw new Error('Empty task prompt');
  if (!isAbsolute(cli) || !existsSync(cli)) throw new Error('Explicit existing CLI path required');
  const runs = resolve(root, '.tmnt/runs');
  mkdirSync(runs, { recursive: true });
  // A new directory per invocation preserves prior evidence, including retries.
  const { mkdtempSync } = await import('node:fs');
  const runDir = mkdtempSync(resolve(runs, `${task}-${role}-`));
  const finalPath = resolve(runDir, 'response.md');
  const eventsPath = resolve(runDir, 'events.jsonl');
  const stderrPath = resolve(runDir, 'stderr.log');
  const stdout = createWriteStream(eventsPath, { flags: 'wx' });
  const stderr = createWriteStream(stderrPath, { flags: 'wx' });
  const args = [...prefix, 'exec', '--sandbox', sandbox, '--cd', root, '--json',
    '--output-last-message', finalPath];
  // Network permissions inherit from the approved host configuration.
  args.push('-');
  let timedOut = false;
  let launchError;
  let loggingError;
  let killError;
  let child;
  try {
    child = spawn(cli, args, { cwd: root, shell: false, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    // Windows can reject a non-executable synchronously (EFTYPE).
    stdout.on('error', () => {});
    stderr.on('error', () => {});
    stdout.end();
    stderr.end();
    return { status: 'failed', reason: error.message, workerExitCode: null,
      signal: null, timedOut: false, runDir, finalPath, eventsPath, stderrPath, lastLine: '' };
  }
  const stop = () => {
    if (!child.pid) return Promise.resolve();
    if (process.platform !== 'win32') { child.kill('SIGKILL'); return Promise.resolve(); }
    return new Promise((done) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'],
        { shell: false, windowsHide: true, stdio: 'ignore' });
      const killTimer = setTimeout(() => { killError = 'taskkill cleanup timeout'; killer.kill(); child.kill(); done(); }, 3000);
      killer.once('error', (error) => { clearTimeout(killTimer); killError = error.message; child.kill(); done(); });
      killer.once('close', (code) => { clearTimeout(killTimer); if (code !== 0) { killError = `taskkill exit ${code}`; child.kill(); } done(); });
    });
  };
  let stopping;
  const onLogError = (error) => { loggingError = error.message; stopping ??= stop(); };
  stdout.on('error', onLogError);
  stderr.on('error', onLogError);
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  child.on('error', (error) => { launchError = error.message; });
  child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') launchError = error.message; });
  const timer = setTimeout(() => { timedOut = true; stopping ??= stop(); }, timeoutMs);
  let cleanupTimer;
  const closed = new Promise((done) => {
    child.once('close', (code, signal) => done({ code, signal }));
    cleanupTimer = setTimeout(() => {
      killError = 'process cleanup incomplete; inspect descendants before retry';
      child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
      stdout.destroy(); stderr.destroy(); child.unref();
      done({ code: null, signal: null });
    }, timeoutMs + 5000);
  });
  child.stdin.end(`${workerBoundary}\n\n${prompt}`, 'utf8');
  const { code, signal } = await closed;
  clearTimeout(timer);
  clearTimeout(cleanupTimer);
  if (stopping) await stopping;
  await Promise.all([stdout, stderr].map((stream) => stream.closed ? undefined :
    new Promise((done) => { stream.once('close', done); })));
  let response = '';
  try { response = readFileSync(finalPath, 'utf8').trim(); } catch (error) {
    if (error.code !== 'ENOENT') loggingError = error.message;
  }
  const lastLine = response.split(/\r?\n/).filter((line) => line.trim()).at(-1)?.trim() ?? '';
  let status = 'failed';
  let reason = launchError || loggingError || killError || (timedOut ? 'timeout' :
    code !== 0 ? `worker exit ${code}, signal ${signal}` : 'missing final terminator');
  if (!launchError && !loggingError && !killError && !timedOut && code === 0) {
    if (lastLine === 'DONE') { status = 'verify'; reason = 'Independent DoD verification required'; }
    else if (/^QUESTION:\s*\S/.test(lastLine)) { status = 'blocked: question'; reason = lastLine; }
  }
  return { status, reason, workerExitCode: code, signal, timedOut, runDir,
    finalPath, eventsPath, stderrPath, lastLine, response };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i];
      if (!['--cli', '--task', '--role', '--sandbox', '--timeout-ms'].includes(key) ||
          process.argv[i + 1] === undefined || options[key] !== undefined) throw new Error('Invalid arguments');
      options[key] = process.argv[i + 1];
    }
    process.stdin.setEncoding('utf8');
    let prompt = '';
    for await (const chunk of process.stdin) prompt += chunk.toString('utf8');
    const result = await runWorker({ cli: options['--cli'], task: options['--task'],
      role: options['--role'], sandbox: options['--sandbox'],
      timeoutMs: options['--timeout-ms'] === undefined ? undefined : Number(options['--timeout-ms']), prompt });
    console.log(JSON.stringify(result));
    process.exitCode = result.status === 'verify' ? 0 : result.status === 'blocked: question' ? 2 : result.timedOut ? 124 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
