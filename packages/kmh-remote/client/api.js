import { z } from 'zod';
// kmh-remote 设置页签 RPC 契约（client 与 host 共享）
export const POCKET_RPC_CHANNEL = '/kmh-remote';
export const MOBILE_RIGHTBAR_ATTRIBUTE = 'data-kmh-remote-mobile-rightbar';
export const MOBILE_RIGHTBAR_EVENT = 'kmh-remote:mobile-rightbar';

export const POCKET_ENDPOINTS = Object.freeze({
  status: 'pocket.status',
  publicSetUrl: 'public.setUrl',
  lanTokenRefresh: 'token.lanRefresh',
  lanAuthSetEnabled: 'lanAuth.setEnabled',
  lanSetOverride: 'lan.setOverride',
  lanSetEnabled: 'lan.setEnabled',
  mobileRightbarSetEnabled: 'mobile.rightbar.setEnabled',
  pinSetCustom: 'pin.setCustom',
  pocketReset: 'pocket.reset',
  // 移动端「复制文件内容」（issue #17）：手机经此 RPC 让主机读取文件正文，
  // 再写入剪贴板——因为手机无法直接打开电脑上的文件。
  fileRead: 'pocket.fileRead',
});

/** 浏览器可见的状态字段（无敏感信息；含二维码 data URL）。 */
export function redactStatus(s) {
  return {
    proxyRunning: s?.proxyRunning === true,
    proxyPort: s?.proxyPort ?? null,
    lanUrl: s?.lanUrl ?? null,
    lanQr: s?.lanQr ?? null,
    lanCandidates: Array.isArray(s?.lanCandidates) ? s.lanCandidates : [],
    lanIpOverride: s?.lanIpOverride ?? '',
    publicUrl: s?.publicUrl ?? '',
    publicQr: s?.publicQr ?? null,
    dshPort: s?.dshPort ?? null,
  };
}

/** 移动端读取的状态投影与文件响应契约。 */
export const MobileStatusSchema = z.object({
  mobileRightbarEnabled: z.boolean().optional(),
  enabled: z.boolean().optional(),
});
export const FileReadResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    value: z.object({
      content: z.string(),
      path: z.string(),
      size: z.number(),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);

/** 外部 frp 地址：允许 http(s)，补全协议并拒绝 URL 内嵌凭据。 */
export const PublicUrlSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    if (!value) return '';
    try {
      const url = new URL(value.includes('://') ? value : `https://${value}`);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        !url.hostname
      )
        throw new Error();
      return url.href;
    } catch {
      context.addIssue({
        code: 'custom',
        message: '请填写有效的 HTTP 或 HTTPS 地址',
      });
      return z.NEVER;
    }
  });

/** 设置页消费的完整状态投影。 */
export const RemoteStatusSchema = z.object({
  proxyRunning: z.boolean(),
  proxyPort: z.number().nullable(),
  dshPort: z.number().nullable(),
  lanUrl: z.string().nullable(),
  lanQr: z.string().nullable(),
  lanCandidates: z.array(z.string()),
  lanIpOverride: z.string(),
  publicUrl: z.string(),
  publicQr: z.string().nullable(),
  accessToken: z.string().nullable(),
  lanToken: z.string().nullable(),
  lanAuthEnabled: z.boolean(),
  lanEnabled: z.boolean(),
  mobileRightbarEnabled: z.boolean(),
  publicPinCustom: z.boolean(),
  lanPinCustom: z.boolean(),
});
