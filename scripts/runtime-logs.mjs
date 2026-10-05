/** 将启动进程输出同时追加到 KMH 私有文件与调用端，保留字节、退出码和停止信号。 */
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

/** 创建一次启动的独占日志目录；输入输出保持原有协议，写入失败终止子进程并报错。 */
export async function runLogged(command, args, { home, label, cwd, env, stdout = process.stdout, stderr = process.stderr }) {
  const logs = join(home, 'logs');
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const logDir = mkdtempSync(join(logs, `${safeLabel}-${stamp}-`));
  const outPath = join(logDir, 'stdout.log');
  const errPath = join(logDir, 'stderr.log');
  const save = (file, data) => writeFileSync(join(logDir, file), JSON.stringify(data) + '\n', { flag: 'wx', mode: 0o600 });
  writeFileSync(outPath, '', { flag: 'wx', mode: 0o600 });
  writeFileSync(errPath, '', { flag: 'wx', mode: 0o600 });
  save('launch.json', { time: new Date().toISOString(), label, cwd, home, node: process.version });
  const child = spawn(command, args, { cwd, env, stdio: ['inherit', 'pipe', 'pipe'] });
  let failure;
  const forward = signal => { child.kill(signal); };
  const onInterrupt = () => forward('SIGINT');
  const onTerminate = () => forward('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  const collect = (stream, file, target) => {
    stream.on('data', chunk => {
      try { appendFileSync(file, chunk, { flush: true }); }
      catch (error) { failure ??= error; child.kill('SIGTERM'); }
    });
    stream.pipe(target, { end: false });
  };
  collect(child.stdout, outPath, stdout);
  collect(child.stderr, errPath, stderr);
  try {
    const result = await new Promise(resolve => {
      child.on('error', error => { failure ??= error; });
      child.once('close', (status, signal) => resolve({ status, signal, logDir }));
    });
    save('exit.json', { time: new Date().toISOString(), status: result.status, signal: result.signal,
      ...failure === undefined ? {} : { error: String(failure) } });
    if (failure !== undefined) throw failure;
    return result;
  } finally {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
  }
}

/** 保存启动器在子进程创建前后报告的异常；日志目录不可写时向调用者传播写入错误。 */
export function recordLauncherFailure(home, error) {
  const logs = join(home, 'logs');
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const directory = mkdtempSync(join(logs, `launcher-error-${stamp}-`));
  writeFileSync(join(directory, 'stderr.log'), `kmh: ${error instanceof Error ? error.message : String(error)}\n`, { flag: 'wx', mode: 0o600, flush: true });
  return directory;
}
