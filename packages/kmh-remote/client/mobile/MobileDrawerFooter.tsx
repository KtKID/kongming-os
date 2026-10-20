import type {
  PropsLocale,
  PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots';
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';
import type { NS } from './locales.ts';
import { MobileIcon } from './MobileIcon.tsx';
import { resolveMobileIcons } from './icon-compat.mjs';

/** 宿主图标在加载时解析一次：不同 DSH 版本的导出名不同（见 icon-compat.mjs）。 */
const icons = resolveMobileIcons(primitives);

/** Full props for the sidebar footer action entry. */
export interface MobileDrawerFooterProps
  extends PropsRuntime<'sidebar.footer.action'>, PropsLocale<typeof NS> {
  /** Bound ctx.layout.toggleSidebar(): the Files sheet closes the drawer. */
  toggleSidebar: () => void;
}

/**
 * 手机侧栏底部的文件入口；会话日志沿用宿主的会话菜单：
 * - Files: opens the dsh-web-ui aionui explorer as a floating bottom sheet
 *   (the explorer column is hidden on mobile until this marker is set, so
 *   the suite's own persisted-expanded state can never cover the UI on load).
 * Hidden entirely on wide screens (CSS media query).
 */
export function MobileDrawerFooter({
  toggleSidebar,
  t,
}: MobileDrawerFooterProps) {
  const openExplorer = (): void => {
    document
      .querySelector('[data-mobile-nav="frame"]')
      ?.setAttribute('data-aionui-explorer-open', '');
    toggleSidebar();
  };
  return (
    <div data-mobile-nav="drawer-actions">
      <primitives.Button
        variant="toolbar"
        type="button"
        data-mobile-nav="explorer"
        aria-label={t('files')}
        title={t('files')}
        onClick={openExplorer}
      >
        <MobileIcon icon={icons.panelLeft} name="panelLeft" size={14} />
        <span>{t('files')}</span>
      </primitives.Button>
    </div>
  );
}
