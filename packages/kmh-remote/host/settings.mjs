// KMH Remote 本地设置；公网转发由现有 frp 管理。
import { PublicUrlSchema } from '../client/api.js';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { isValidIpv4 } from './ip.mjs';

const settingsRel = join('kmh-remote', 'settings.json');
export function settingsPath() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), settingsRel);
}

function readSettings() {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    /* 无文件/损坏 → 默认 */
  }
  return {};
}

function writeSettings(s) {
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2), { mode: 0o600 });
  } catch {
    /* 忽略 */
  }
  return s;
}

/** 局域网访问总开关：默认开启（文件缺失/损坏都视为开启）。 */
export function lanEnabled() {
  return readSettings().lanEnabled !== false;
}

/** 设置局域网访问总开关，返回新状态（持久化）。 */
export function setLanEnabled(on) {
  const s = readSettings();
  s.lanEnabled = !!on;
  writeSettings(s);
  return s.lanEnabled;
}

/** 局域网访问密码开关：默认开启（文件缺失/损坏都视为开启）。 */
export function lanAuthEnabled() {
  return readSettings().lanAuthEnabled !== false;
}

/** 设置局域网访问密码开关，返回新状态（持久化）。 */
export function setLanAuthEnabled(on) {
  const s = readSettings();
  s.lanAuthEnabled = !!on;
  writeSettings(s);
  return s.lanAuthEnabled;
}

/** 手机端右边栏入口：默认开启，可按需关闭以保持更紧凑的标题栏。 */
export function mobileRightbarEnabled() {
  return readSettings().mobileRightbarEnabled !== false;
}

/** 设置手机端右边栏入口，返回新状态（持久化）。 */
export function setMobileRightbarEnabled(on) {
  const s = readSettings();
  s.mobileRightbarEnabled = !!on;
  writeSettings(s);
  return s.mobileRightbarEnabled;
}

/** 局域网地址手动覆盖：默认空字符串 = 自动选择。 */
export function lanIpOverride() {
  return readSettings().lanIpOverride ?? '';
}

/** 设置局域网地址覆盖；空字符串清除覆盖，恢复自动选择。非法 IPv4 抛错。 */
export function setLanIpOverride(value) {
  const ip = String(value ?? '').trim();
  if (ip && !isValidIpv4(ip)) {
    throw new Error(
      '局域网地址必须是 IPv4 地址 | LAN address must be an IPv4 address',
    );
  }
  const s = readSettings();
  if (ip) s.lanIpOverride = ip;
  else delete s.lanIpOverride;
  writeSettings(s);
  return ip;
}

// ---------- 访问密码「自定义」标记（issue #33） ----------
// 用户可把公网/局域网密码设成自己固定的 8–64 位密码（英文字母大小写或数字；自定义后不再自动轮换）。
// 标记存 settings.json：publicPinCustom / lanPinCustom。
const PIN_CUSTOM_KEYS = { public: 'publicPinCustom', lan: 'lanPinCustom' };

/** 该 PIN（public | lan）是否用户自定义过（自定义后不自动轮换）。 */
export function pinCustom(which) {
  const key = PIN_CUSTOM_KEYS[which];
  if (!key) return false;
  return readSettings()[key] === true;
}

/** 设置自定义标记，返回新状态。 */
export function setPinCustom(which, on) {
  const key = PIN_CUSTOM_KEYS[which];
  if (!key) return false;
  const s = readSettings();
  s[key] = !!on;
  writeSettings(s);
  return !!on;
}

// ---------- 恢复出厂设置 ----------
// 设置出问题时的临时兜底：删掉 settings.json 即回到出厂默认（文件缺失 = 默认开启，
// 于是局域网访问开、访问密码开、手机端右边栏开、局域网地址自动、公网模式随机）。
// DSH 自身的会话、模型、插件配置都在 $DSH_HOME 的其他目录，不受影响。

/** 删除本机设置文件（不存在也算成功）；返回 true 表示已清空。 */
export function resetSettings() {
  try {
    rmSync(settingsPath(), { force: true });
    return true;
  } catch {
    return false;
  }
}

export function proxyPort() {
  const v = Number(readSettings().proxyPort);
  return Number.isInteger(v) && v >= 1 && v <= 65535 ? v : 0;
}

/** 设置代理端口（持久化）。空/0/非法值清除，回退默认 3081。 */
export function setProxyPort(value) {
  const n = Number(value);
  const s = readSettings();
  if (Number.isInteger(n) && n >= 1 && n <= 65535) s.proxyPort = n;
  else delete s.proxyPort;
  writeSettings(s);
  return proxyPort();
}

/** 已保存的 frp 公网入口；旧的非法值按空地址处理。 */
export function publicUrl() {
  const result = PublicUrlSchema.safeParse(readSettings().publicUrl ?? '');
  return result.success ? result.data : '';
}
/** 校验并持久化外部访问地址，非法值向调用方抛错。 */
export function setPublicUrl(value) {
  const url = PublicUrlSchema.parse(value);
  const settings = readSettings();
  if (url) settings.publicUrl = url;
  else delete settings.publicUrl;
  writeSettings(settings);
  return url;
}
