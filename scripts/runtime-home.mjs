/** 解析 KMH 数据根目录；构造固定数据路径与临时路径的子进程环境。 */
import { mkdirSync, readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** 读取本地覆盖文件中的 KMH_HOME 行；文件不存在返回 undefined，其他读取错误抛出。 */
function readLocalKmhHome(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*KMH_HOME\s*=(.*)$/.exec(line);
    if (match && match[1].trim() !== '') return match[1].trim();
  }
  return undefined;
}

/** 按环境变量、仓库根 .env.local、默认 ~/.kmh 的顺序解析；显式路径要求绝对路径或 ~/ 前缀。 */
export function resolveKmhHome(env = process.env, localFile = join(repositoryRoot, '.env.local')) {
  const configured = env.KMH_HOME !== undefined && env.KMH_HOME.trim() !== '' ? env.KMH_HOME : readLocalKmhHome(localFile);
  const userHome = userInfo().homedir;
  if (configured === undefined || configured.trim() === '') return join(userHome, '.kmh');
  const selected = configured === '~' ? userHome
    : configured.startsWith('~/') || configured.startsWith('~\\') ? join(userHome, configured.slice(2)) : configured;
  if (!isAbsolute(selected)) throw new Error('KMH_HOME 必须是绝对路径或 ~/ 开头的路径');
  return normalize(selected);
}

/** 创建私有数据和临时目录；复制环境并固定 KMH、DSH、ZCode 与临时根目录。 */
export function runtimeEnvironment(home, inherited = process.env) {
  const temporary = join(home, 'tmp');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(temporary, { recursive: true, mode: 0o700 });
  return { ...inherited, KMH_HOME: home, DSH_HOME: home,
    ZCODE_DATA_BASE_DIR: join(home, 'zcode-cli'), TMPDIR: temporary, TMP: temporary, TEMP: temporary };
}
