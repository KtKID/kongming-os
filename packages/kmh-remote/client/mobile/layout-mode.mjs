// 布局模式判定（issue #74：宽屏手机/Pad 可选电脑布局）
//
// 优先级：URL 参数 (?dsh-layout=desktop|mobile|auto) > localStorage > 默认 auto。
//   - 'auto' 不写 localStorage，仅按 matchMedia 走；
//   - 显式 'desktop' / 'mobile' 同步到 localStorage，下次无 URL 参数也走同样布局。
//
// 纯函数，便于单测；mobile-apply.tsx 读 DOM/localStorage 喂进来。

/** @typedef {'mobile' | 'desktop'} ForcedLayout */

/** 按 URL、持久偏好和屏幕宽度解析布局。
 * @param {{urlValue: string, stored: string, narrowMatch: boolean}} options 布局输入。
 * @returns {ForcedLayout} 当前布局。
 */
export function resolveLayout({ urlValue, stored, narrowMatch }) {
  const url = String(urlValue ?? '').trim();
  if (url === 'desktop') return 'desktop';
  if (url === 'mobile') return 'mobile';
  // 'auto' / 空 / 非法值 → 用 localStorage / matchMedia
  if (stored === 'desktop' || stored === 'mobile') return stored;
  return narrowMatch ? 'mobile' : 'desktop';
}

/** 同步 URL 中的布局偏好，存储失败返回空值。
 * @param {string} urlValue URL 参数。
 * @returns {ForcedLayout | ""} 最终存储值。
 */
export function persistLayoutFromUrl(urlValue) {
  if (typeof localStorage === 'undefined') return '';
  const v = String(urlValue ?? '').trim();
  try {
    if (v === 'desktop' || v === 'mobile')
      localStorage.setItem('kmh-remote.layout', v);
    else if (v === 'auto' || v === '')
      localStorage.removeItem('kmh-remote.layout');
  } catch {
    /* 隐私模式/无 storage → 静默 */
  }
  try {
    const s = localStorage.getItem('kmh-remote.layout');
    return s === 'desktop' || s === 'mobile' ? s : '';
  } catch {
    return '';
  }
}

/** 读 localStorage 当前的 layout 值（'desktop' | 'mobile' | ''）。 */
export function readStoredLayout() {
  if (typeof localStorage === 'undefined') return '';
  try {
    const v = localStorage.getItem('kmh-remote.layout');
    return v === 'desktop' || v === 'mobile' ? v : '';
  } catch {
    return '';
  }
}
