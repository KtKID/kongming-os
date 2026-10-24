// KMH Remote 服务：选择局域网地址、生成二维码并管理本地 HTTP/WebSocket 代理。
import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createPocketProxy } from './proxy.mjs';
import { isValidIpv4 } from './ip.mjs';

const require = createRequire(import.meta.url);

/** URL → 二维码 data URL（浏览器 <img> 直接显示，全本地不依赖第三方）。 */
export async function qrDataUrl(text, { width = 220, margin = 1 } = {}) {
  const QRCode = require('qrcode');
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin,
    width,
    type: 'image/png',
  });
}

// RFC1918 私网地址：手机与电脑连同一局域网时通常可直连。
// 另含 CGNAT 100.64/10（RFC 6598，Tailscale/ZeroTier 默认网段，公网不可路由），保持一致（issue #79）。
const PRIVATE_IPV4_RE =
  /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1(?:0\d|1\d|2[0-7]))\.)/;

/** 名称像真实物理网卡的接口（WLAN / Wi-Fi / Ethernet / 以太网 / 有线 / 无线 / en / eth）。
 *  注意：`本地连接` 用负前瞻 `(?!\*)` 排除 Windows 的「移动热点 / Internet 连接共享（ICS）」
 *  虚拟适配器 `本地连接* N`（IP 固定 192.168.137.1，手机连真实 Wi-Fi 时与它不在同一网段，
 *  扫码不可达）——issue #176。 */
const PHYSICAL_IFACE_RE =
  /^(?:wlan|wi-?fi|wireless|ethernet|eth\d|en\d|wlp\d|以太网|有线|无线|本地连接(?!\*))/i;

/** 常见的 VPN / 虚拟网卡名称：手机通常无法通过它们直连电脑。
 *  含 Windows ICS / 移动热点（`本地连接*`）与承载网络 / Wi-Fi Direct 虚拟适配器——issue #176。 */
const VPN_IFACE_RE =
  /(?:radmin|tailscale|zerotier|easytier|et_|tun|tap|vpn|vethernet|virtual|vmware|virtualbox|wsl|docker|teredo|hamachi|bluetooth|bridge|本地连接\*|hostednetwork|wifidirect)/i;

/**
 * 从 networkInterfaces() 返回的接口表里选出手机最可能可达的 IPv4。
 *
 * `os.networkInterfaces()` 的枚举顺序不可靠：Windows 上 Radmin VPN / Tailscale /
 * vEthernet 等虚拟网卡常排在 WLAN 前面，旧实现直接取第一张非回环网卡，会生成
 * 手机打不开的二维码。这里按以下规则打分排序：
 *   - RFC1918 私网地址优先（10/8、172.16/12、192.168/16）；
 *   - 名称像物理网卡再加分；
 *   - 名称像 VPN/虚拟网卡减分；
 *   - 同分保持原枚举顺序。
 * 没有任何私网地址时回退到最高分地址（例如纯 VPN 环境仍可用）。
 *
 * @param {ReturnType<typeof networkInterfaces>} interfaces
 * @returns {string|null}
 */
export function selectLanIPv4(interfaces) {
  const candidates = [];
  for (const [name, addrs] of Object.entries(interfaces ?? {})) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const ip = addr.address;
      // 排除 loopback 与 link-local；其余地址即使不是私网（如 Radmin 的 26.x）也保留兜底
      if (!ip || ip.startsWith('127.') || ip.startsWith('169.254.')) continue;

      let score = 0;
      if (PRIVATE_IPV4_RE.test(ip)) score += 100;
      if (PHYSICAL_IFACE_RE.test(name)) score += 20;
      else if (VPN_IFACE_RE.test(name)) score -= 50;

      candidates.push({ ip, score, order: candidates.length });
    }
  }

  // 兜底：同分时不选 ICS 保留段 192.168.137.x（移动热点 / 共享虚拟网卡），避免误指向不可达地址。
  const isIcsSubnet = (ip) => ip.startsWith('192.168.137.');
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      (isIcsSubnet(a.ip) === isIcsSubnet(b.ip)
        ? a.order - b.order
        : isIcsSubnet(a.ip)
          ? 1
          : -1),
  );
  return candidates[0]?.ip ?? null;
}

// ---------- WSL 局域网 IP（issue #39） ----------
// WSL2 是 NAT 模式：WSL 内部 os.networkInterfaces() 只能看到自己的虚拟网卡
// （172.x.x.x），看不到 Windows 宿主机的物理网卡 IP（192.168.x.x）——手机在
// 同一 WiFi 下访问的是 Windows 宿主机，拿 WSL 的 IP 生成的二维码必然打不开。
// 解法：检测到 WSL 时，通过 WSL interop 直接执行 Windows 的 ipconfig.exe，
// 解析出 Windows 侧非虚拟网卡的 IPv4 作为局域网地址；失败回退本机探测。

/** WSL 检测：/proc/version 含 microsoft/wsl，或 WSL 专属环境变量存在。 */
export function detectWsl() {
  try {
    const v = readFileSync('/proc/version', 'utf8').toLowerCase();
    if (v.includes('microsoft') || v.includes('wsl')) return true;
  } catch {
    /* 非 Linux：无 /proc/version */
  }
  // 注意：**不能**用 WSLENV 判据——Windows Terminal 在原生 Windows 上也会设置
  // WSLENV（如 WT_SESSION:WT_PROFILE_ID:），会误判成 WSL。只认 WSL 内部才有的变量。
  return Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
}

/**
 * 解析 ipconfig.exe 输出，默认取非虚拟网卡块的 IPv4 地址（保持输出顺序）。
 * 支持中文（`IPv4 地址 . . . :`）与英文（`IPv4 Address. . . :`）两种格式。
 * @param {string} text ipconfig.exe 的完整输出
 * @param {{ includeVpn?: boolean }} [opts] 传 includeVpn 时保留 Tailscale/VPN 等候选
 * @returns {string[]} 候选 IPv4 列表
 */
export function parseIpconfig(text, { includeVpn = false } = {}) {
  const out = [];
  // 网卡块：块标题行顶格（行首无缩进），其后内容行带缩进
  const blocks = String(text).split(/\r?\n(?=\S)/);
  const ipRe =
    /IPv4[^0-9]{0,40}((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)/;
  for (const block of blocks) {
    const title = String(block.split(/\r?\n/)[0] ?? '');
    // 跳过虚拟网卡块（vEthernet (WSL)、Docker、VirtualBox、VPN 等）
    if (!includeVpn && VPN_IFACE_RE.test(title)) continue;
    const m = block.match(ipRe);
    if (m) out.push(m[0].replace(/^IPv4[^0-9]*/i, ''));
  }
  return out;
}

function runIpconfig() {
  // WSL 内 PATH 可能不含 Windows System32；用绝对路径兜底
  const candidates = ['ipconfig.exe', '/mnt/c/Windows/System32/ipconfig.exe'];
  return new Promise((resolve) => {
    const tryNext = (i) => {
      if (i >= candidates.length) return resolve(null);
      execFile(
        candidates[i],
        [],
        { timeout: 5000, windowsHide: true },
        (err, stdout) => {
          if (err || !stdout) return tryNext(i + 1);
          resolve(String(stdout));
        },
      );
    };
    tryNext(0);
  });
}

async function lanIPv4() {
  // WSL：优先 Windows 物理网卡 IP（手机可达）；超时/失败回退本机探测
  if (detectWsl()) {
    try {
      const out = await runIpconfig();
      const candidates = parseIpconfig(out ?? '');
      const ip =
        candidates.find((c) => PRIVATE_IPV4_RE.test(c)) ?? candidates[0];
      if (ip) return ip;
    } catch {
      /* 回退 */
    }
  }
  return selectLanIPv4(networkInterfaces());
}

/** 收集所有可手动选择的局域网/Tailnet 候选 IP（WSL 下以 Windows ipconfig 为准）。 */
async function listLanCandidates() {
  if (detectWsl()) {
    try {
      const out = await runIpconfig();
      const ips = parseIpconfig(out ?? '', { includeVpn: true });
      if (ips.length) return [...new Set(ips)];
    } catch {
      /* 回退 */
    }
  }
  const ips = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const ip = addr.address;
      if (!ip || ip.startsWith('127.') || ip.startsWith('169.254.')) continue;
      if (!ips.includes(ip)) ips.push(ip);
    }
  }
  return ips;
}

/** 创建本地代理服务；公网 URL 由现有 frp 提供，启动失败向调用方抛错。 */
export function createPocketService({
  dshPort,
  port = 60001,
  internals = {},
  getLanIpOverride,
  getLanEnabled = () => true,
  getPublicUrl = () => '',
  injectHtml,
  auth,
  launchToken = () => '',
  onPasswordAttempt = null,
} = {}) {
  const createProxy = internals.createProxy ?? createPocketProxy;
  const encodeQr = internals.encodeQr ?? qrDataUrl;
  let proxy = null;
  let starting = null;
  let disposed = false;
  let lanCache = null;
  const qrCache = new Map();
  /** 同一地址复用二维码；编码失败清除缓存，供下次状态读取重试。 */
  async function qrCached(url) {
    if (!url) return null;
    if (!qrCache.has(url)) {
      if (qrCache.size >= 8) qrCache.delete(qrCache.keys().next().value);
      qrCache.set(
        url,
        Promise.resolve()
          .then(() => encodeQr(url))
          .catch(() => {
            qrCache.delete(url);
            return null;
          }),
      );
    }
    return qrCache.get(url);
  }
  /** 验证手动地址，空值交给系统网卡发现。 */
  function lanOverride() {
    const value = String(getLanIpOverride?.() ?? '').trim();
    return isValidIpv4(value) ? value : '';
  }
  return {
    dshPort,
    /** 并发启动共享一次监听；固定端口便于 frp 转发，端口冲突直接报错。 */
    async startProxy() {
      if (disposed) throw new Error('KMH Remote 已卸载');
      if (proxy) return proxy;
      if (starting) return starting;
      starting = Promise.resolve()
        .then(() =>
          createProxy({
            port,
            host: '0.0.0.0',
            upstream: { host: '127.0.0.1', port: dshPort },
            ...(injectHtml ? { injectHtml } : {}),
            ...(auth ? { auth } : {}),
            lanAccessEnabled: getLanEnabled,
            launchToken,
            onPasswordAttempt,
          }),
        )
        .then(async (instance) => {
          if (disposed) {
            await instance.close();
            throw new Error('KMH Remote 在启动过程中卸载');
          }
          proxy = instance;
          return instance;
        })
        .finally(() => {
          starting = null;
        });
      return starting;
    },
    /** 返回当前地址和二维码；frp 的运行状态由其自身管理。 */
    async status() {
      const override = lanOverride();
      const ip =
        override ||
        (await (internals.lanIPv4 ? internals.lanIPv4() : lanIPv4()));
      if (!lanCache || Date.now() - lanCache.at > 15000) {
        lanCache = {
          at: Date.now(),
          ips: await (internals.lanCandidates
            ? internals.lanCandidates()
            : listLanCandidates()),
        };
      }
      const lanUrl = proxy && ip ? `http://${ip}:${proxy.port}` : null;
      const publicUrl = String(getPublicUrl() ?? '');
      return {
        proxyRunning: proxy !== null,
        proxyPort: proxy?.port ?? null,
        dshPort,
        lanUrl,
        lanQr: await qrCached(lanUrl),
        lanCandidates: lanCache.ips,
        lanIpOverride: override,
        publicUrl,
        publicQr: await qrCached(publicUrl),
      };
    },
    /** 等待正在进行的启动完成并释放监听，重复调用保持幂等。 */
    async dispose() {
      disposed = true;
      await starting?.catch(() => {});
      const current = proxy;
      proxy = null;
      await current?.close();
      qrCache.clear();
    },
  };
}
