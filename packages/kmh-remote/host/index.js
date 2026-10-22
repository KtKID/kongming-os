// KMH Remote：加载本地鉴权代理与设置通道，卸载时回收监听。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomInt } from 'node:crypto';
import { createAccessRecords } from './access-records.js';

import { createPocketService } from './service.mjs';
import { installPocketRpc } from './web-rpc.js';
import {
  lanEnabled,
  setLanEnabled,
  lanAuthEnabled,
  setLanAuthEnabled,
  mobileRightbarEnabled,
  setMobileRightbarEnabled,
  lanIpOverride,
  setLanIpOverride,
  pinCustom,
  setPinCustom,
  resetSettings,
  proxyPort,
  publicUrl,
  setPublicUrl,
} from './settings.mjs';
import { classifyHost } from './proxy.mjs';

const name = '@kmh/remote';
const inject = ['connection', 'webServer'];

// ---------- 访问密码（issue #13 + #18 + #33） ----------
// 公网与局域网**分开**：各自 8 位，存本机 $DSH_HOME/kmh-remote/。
// frp 公网密码持久保存在本机，用户在设置页主动更新。
// 局域网密码（token-lan）：默认手动刷新（设置页按钮）；自定义后刷新会换回随机值。
// 会话保持（issue #33）：登录 cookie 绑定进程级 sessionKey（见 apply）——
// dsh web 重启/更新后 sessionKey 变化 → 手机需重新输入。
// 默认 PIN 为 8 位数字；自定义 PIN 可使用 8–64 位英文字母（大小写）或数字。
const PIN_RE = /^[a-zA-Z0-9]{8,64}$/;
function writePinToFile(p, fresh) {
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, fresh, { mode: 0o600 });
  } catch {
    /* 忽略 */
  }
  return fresh;
}
function readPin(p) {
  try {
    const existing = readFileSync(p, 'utf8').trim();
    if (PIN_RE.test(existing)) return existing;
  } catch {
    /* 无文件 */
  }
  return null;
}
/**
 * 生成 8 位访问 PIN（issue #90）。
 * 必须用 CSPRNG。语言内置的非加密随机数（V8 的 xorshift128+）是可预测的：拿到少量
 * 输出即可还原内部状态并推算后续值——用它生成访问密码，等于把 9×10⁷ 的搜索空间
 * 进一步压缩。`randomInt(min, max)` 上界开区间，取值 10000000..99999999。
 * test/auth-routing.test.js 有源码守卫，禁止这里再出现非加密随机数调用。
 */
function newPin() {
  return String(randomInt(10_000_000, 100_000_000));
}

// --- 公网密码 ---
const tokenRel = join('kmh-remote', 'token');
function tokenPath() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), tokenRel);
}
/** 当前公网访问密码；文件不存在时生成一个。 */
export function getAccessToken() {
  return readPin(tokenPath()) ?? writePinToFile(tokenPath(), newPin());
}
/** 轮换公网密码（开启公网时调用）。用户自定义后不再轮换（尊重自定义值）。 */
export function rotateAccessToken() {
  if (pinCustom('public')) return getAccessToken();
  return writePinToFile(tokenPath(), newPin());
}

// --- 局域网密码（issue #18：局域网与公网分开，手动刷新） ---
const lanTokenRel = join('kmh-remote', 'token-lan');
function lanTokenPath() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), lanTokenRel);
}
/** 当前局域网访问密码；文件不存在时生成一个。 */
function getLanToken() {
  return readPin(lanTokenPath()) ?? writePinToFile(lanTokenPath(), newPin());
}
/** 刷新局域网密码（设置页按钮触发，旧密码立即作废）；换新后清除自定义标记。 */
function refreshLanToken() {
  setPinCustom('lan', false);
  return writePinToFile(lanTokenPath(), newPin());
}
/**
 * 按 Host 分发的访问密码（issue #66：fail closed）。
 * 公网 = classifyHost 判为 public 的 Host（外部 frp 域名），
 * 一律校验公网密码；loopback/局域网（私网 IP、.local 等）才走局域网密码——
 * 自建隧道 + 关闭局域网密码不再出现公网裸奔。
 */
export function tokenForHost(host) {
  if (isLanOverrideHost(host)) return getLanToken();
  return classifyHost(host) === 'public' ? getAccessToken() : getLanToken();
}

/** frp 与局域网均使用持久访问密码。 */
export function credentialKindForHost() {
  return 'persistent';
}

/** 去掉 Host 的端口（与 classifyHost 一致），用于和手动设置的局域网地址比较。 */
function hostNameOnly(host) {
  let name = String(host ?? '')
    .trim()
    .toLowerCase();
  if (name.startsWith('[')) {
    const end = name.indexOf(']');
    if (end >= 0) name = name.slice(1, end);
  } else {
    name = name.replace(/:\d+$/, '');
  }
  return name;
}
/**
 * 用户手动指定的「局域网地址」覆盖（issue #79）：无论什么网段（含 Radmin 26.x 等任意 overlay），
 * 一律按局域网密码/开关裁决。优先级高于 classifyHost——避免某 overlay 地址落在公网判定里、
 * 导致局域网入口被错判成公网、比对成公网密码而永远「密码错误」。
 */
export function isLanOverrideHost(host) {
  const override = lanIpOverride().trim().toLowerCase();
  return override.length > 0 && hostNameOnly(host) === override;
}
/**
 * 用户自定义访问密码（issue #33）：公网/局域网各自设置固定的 8–64 位密码（英文字母大小写或数字）。
 * 自定义后公网开启时不再自动轮换（rotateAccessToken 见上）。
 * 非法输入（少于 8 位、超过 64 位或含字母数字以外字符）抛错，由 RPC 层转成错误响应。
 */
export function setCustomPin(which, value) {
  const v = String(value ?? '').trim();
  if (v === '') {
    setPinCustom(which, false);
    if (which === 'public') return writePinToFile(tokenPath(), newPin());
    if (which === 'lan') return writePinToFile(lanTokenPath(), newPin());
  }
  if (!PIN_RE.test(v))
    throw new Error(
      '密码必须是 8–64 位英文字母或数字 | PIN must be 8–64 characters (letters and digits only)',
    );
  if (which === 'public') {
    writePinToFile(tokenPath(), v);
    setPinCustom('public', true);
    return v;
  }
  if (which === 'lan') {
    writePinToFile(lanTokenPath(), v);
    setPinCustom('lan', true);
    return v;
  }
  throw new Error('未知密码类型 | unknown PIN kind');
}

/**
 * 恢复出厂设置（设置页底部按钮）：清空本机设置 + 重设随机访问密码。
 *
 * 删除 settings.json → 所有开关回到默认（局域网访问开、访问密码开、局域网地址自动、
 * frp 地址清空）；公网与局域网密码都换新随机 8 位值
 * （旧密码立即作废，手机需重新输入）。只动 $DSH_HOME/kmh-remote/ 下的文件，
 * DSH 自身的会话、模型、插件配置不受影响。
 *
 * @returns {{accessToken:string, lanToken:string}} 重置后的新密码
 */
export function resetPocketState() {
  resetSettings();
  writePinToFile(tokenPath(), newPin());
  writePinToFile(lanTokenPath(), newPin());
  return { accessToken: getAccessToken(), lanToken: getLanToken() };
}

/** 挂载 KMH 手机访问；代理启动失败由插件日志报告，卸载等待资源释放。 */
export function apply(ctx, config = {}, internals = {}) {
  const logger = ctx.logger?.(name) ?? console;
  const dshPort = internals.dshPort ?? ctx.webServer?.port;
  if (!dshPort) throw new Error('KMH Remote 需要宿主 Web 服务端口');
  const records = createAccessRecords({
    home: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    log: (error) =>
      logger.error('Remote 记录保存失败：%s %s', error.code, error.desc),
  });
  const service =
    internals.service ??
    createPocketService({
      dshPort,
      port: internals.port ?? config.port ?? (proxyPort() || 60001),
      internals,
      onPasswordAttempt: (attempt) => records.save(attempt),
      getLanIpOverride: lanIpOverride,
      getLanEnabled: lanEnabled,
      getPublicUrl: publicUrl,
      auth: {
        sessionKey: randomBytes(16).toString('hex'),
        getToken: tokenForHost,
        getCredentialKind: credentialKindForHost,
        isProtected: (host) =>
          isLanOverrideHost(host)
            ? lanAuthEnabled()
            : classifyHost(host) === 'public' || lanAuthEnabled(),
      },
      launchToken: () => {
        const authenticatedUrl = ctx.connection?.authenticatedUrl;
        if (typeof authenticatedUrl !== 'function') return '';
        const url = new URL(
          authenticatedUrl.call(ctx.connection, `http://127.0.0.1:${dshPort}`),
        );
        return url.searchParams.get('token') ?? '';
      },
    });
  const disposeRpc = installPocketRpc(ctx, {
    service,
    records,
    getToken: getAccessToken,
    getLanToken,
    refreshLanToken,
    getLanAuthEnabled: lanAuthEnabled,
    setLanAuthEnabled,
    getLanEnabled: lanEnabled,
    setLanEnabled,
    getMobileRightbarEnabled: mobileRightbarEnabled,
    setMobileRightbarEnabled,
    getLanIpOverride: lanIpOverride,
    setLanIpOverride,
    getPinCustom: pinCustom,
    setCustomPin,
    setPublicUrl,
    resetPocket: resetPocketState,
    log: logger,
  });
  ctx.effect(
    () => async () => {
      disposeRpc();
      await service.dispose();
      await records.close();
    },
    'kmh-remote: release local proxy',
  );
  service
    .startProxy()
    .then((proxy) => {
      logger.info('KMH Remote 本地代理已就绪：%d', proxy.port);
    })
    .catch((error) =>
      logger.error('KMH Remote 代理启动失败：%s', error?.message ?? error),
    );
}
export { name, inject };
