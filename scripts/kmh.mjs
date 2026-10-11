/**
 * Kongming 的 DSH 启动入口：setup 安装独立子模块，build 构建底座与自有插件，cli/web/sdk 选择自有 profile。
 * prepareProfiles 注册仓库内 profile/bundle；run 转发命令、工作目录、环境与退出状态。
 * profile 配置由 Kongming 版本控制；会话、凭据和日志写入 KMH_HOME（默认 ~/.kmh）。
 * readLaunchProfiles 读取 launch.config.json 中短命令对应的 profile，并验证目录。
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveKmhHome, runtimeEnvironment } from './runtime-home.mjs';
import { recordLauncherFailure, runLogged } from './runtime-logs.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, 'third_party/dsh');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

/** 运行子进程；输入程序、参数和目录，失败时抛错，成功时返回退出状态。 */
function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' && command.endsWith('.cmd') });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} 被 ${result.signal} 终止`);
  if (result.status !== 0) throw new Error(`${command} 退出状态：${result.status}`);
}

/** 建立目录链接；输入链接位置和目标，已有相同链接保持，冲突立即报错。 */
export function linkDirectory(path, target) {
  mkdirSync(dirname(path), { recursive: true });
  let entry;
  try { entry = lstatSync(path); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (entry) {
    if (realpathSync(path) === realpathSync(target)) return;
    throw new Error(`目录冲突：${path}；请保留原目录后调整 KMH_HOME`);
  }
  symlinkSync(realpathSync(target), path, process.platform === 'win32' ? 'junction' : 'dir');
}

/** 注册自有 profile 和 bundle；输入状态目录，输出保持本地配置的目录链接。 */
export function prepareProfiles(home) {
  for (const entry of readdirSync(join(root, 'profiles'), { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    const directory = join(root, 'profiles', entry.name);
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (spec.startsWith('link:')) linkDirectory(join(directory, 'node_modules', name), resolve(directory, spec.slice(5)));
    }
    linkDirectory(join(home, 'profiles', entry.name), directory);
  }
}

/** 读取短命令的 profile 选择；输入配置路径，输出经过目录校验的模式映射。 */
export function readLaunchProfiles(file = join(root, 'launch.config.json')) {
  const config = JSON.parse(readFileSync(file, 'utf8'));
  const profiles = config?.profiles;
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
    throw new Error(`${file} 的 profiles 必须是命令到 profile 名称的映射`);
  }
  for (const mode of ['cli', 'web', 'sdk']) {
    const name = profiles[mode];
    if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
      throw new Error(`${file} 的 profiles.${mode} 必须是有效的 profile 名称`);
    }
    if (!existsSync(join(root, 'profiles', name, 'package.json'))) {
      throw new Error(`${file} 的 profiles.${mode} 指向缺失的 profile：${name}`);
    }
  }
  for (const key of Object.keys(profiles)) {
    if (!['cli', 'web', 'sdk'].includes(key)) throw new Error(`${file} 的 profiles 含未知命令：${key}`);
  }
  return profiles;
}

/** 选择命令并启动支持的 dsh profile；输入命令行参数，输出子进程日志与状态。 */
export async function main(args = process.argv.slice(2)) {
  const [command = 'help', ...forwarded] = args;
  if (command === 'help' || command === '--help') {
    console.log('Kongming：setup | build | cli <task> | web | sdk | dsh <args> | profiles\nWeb 使用已有构建产物；修改插件后手动运行 pnpm build:kmh。\nlaunch.config.json 选择 profile；profiles/<name>/cordis.patch.yml 配置应用；KMH_HOME 指定运行数据目录。');
    return;
  }
  if (command === 'setup') {
    const registration = spawnSync('git', ['ls-files', '--stage', '--', 'third_party/dsh'], { cwd: root, encoding: 'utf8' });
    if (registration.error) throw registration.error;
    if (registration.status !== 0 || !registration.stdout.startsWith('160000 ')) {
      throw new Error('DSH 子模块登记待完成；请先登记 .gitmodules 和 third_party/dsh 的 Git 指针');
    }
    run('git', ['submodule', 'update', '--init', '--recursive']);
    run(pnpm, ['install', '--frozen-lockfile'], runtime);
    prepareProfiles(resolveKmhHome());
    return;
  }
  if (!existsSync(join(runtime, '.git'))) throw new Error('请先运行 pnpm run setup 初始化 DSH 子模块');
  if (command === 'build') {
    run(pnpm, ['run', 'build'], runtime);
    run(pnpm, ['run', 'build:kmh']);
    return;
  }
  const home = resolveKmhHome();
  const env = runtimeEnvironment(home);
  prepareProfiles(home);
  if (command === 'profiles') {
    console.log(`profile：${join(root, 'profiles')}\nbundle：${join(root, 'bundles')}\n运行数据：${home}`);
    return;
  }
  const profiles = readLaunchProfiles();
  if (command !== 'dsh' && !Object.hasOwn(profiles, command)) throw new Error(`未知命令：${command}`);
  const bin = join(runtime, 'apps/cli/lib/bin.js');
  if (!existsSync(bin)) throw new Error('请先运行 pnpm build 构建 DSH');
  const packages = join(root, 'packages');
  env.KMH_PLUGIN_WATCH_ROOTS = JSON.stringify(command === 'web'
    ? readdirSync(packages, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(packages, entry.name, 'lib')))
      .map(entry => join(packages, entry.name, 'lib'))
    : []);
  const cliArgs = command === 'dsh' ? forwarded : ['--profile', profiles[command], ...forwarded];
  const result = await runLogged(process.execPath, [bin, ...cliArgs], {
    home, label: command === 'dsh' ? 'dsh' : profiles[command], cwd: process.cwd(), env,
  });
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) {
    console.error(`kmh: ${error.message}`);
    try { recordLauncherFailure(resolveKmhHome(), error); } catch (logError) {
      console.error(`kmh: 启动异常记录失败：${logError.message}`);
    }
    process.exitCode = 1;
  }
}
