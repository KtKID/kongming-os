/**
 * kmh-infra 面板与表单的浏览器样式。以 DSH 现有的成熟同类界面为准：面板
 * 工具栏沿用文件预览面板的头部长条（38px 高、0.5px 分隔线、16px 左内边距），
 * 颜色与圆角一律取主题 token，不写字面量。客户端构建是 esbuild 单文件
 * bundle（不支持 css module），样式经 ensureStyles() 以 <style> 注入一次，
 * class 一律加 infra- 前缀避免与宿主样式冲突。
 */

/** 全部附加样式；属性名与取值对齐 DSH --dsw-* token 体系。 */
const styleText = `
.infra-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.infra-toolbar {
  box-sizing: border-box;
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 38px;
  padding: 0 6px 0 16px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}
.infra-address {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  margin-right: 12px;
  max-width: 360px;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.infra-notice {
  margin: 0;
  padding: 6px 10px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  font-size: 12px;
  line-height: 1.6;
}
.infra-frame {
  display: block;
  flex: 1;
  width: 100%;
  min-height: 240px;
  background: var(--dsw-alias-bg-base);
  border: none;
}
.infra-centered {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.infra-field {
  display: grid;
  gap: 6px;
  padding: 12px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.infra-toggle-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
}
.infra-toggle-label {
  flex: 1;
  min-width: 0;
}
.infra-hint {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.5;
}
.infra-health {
  display: grid;
  gap: 4px;
}
.infra-health-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.infra-health-fail {
  color: var(--dsw-alias-state-error-primary);
}
`;

const STYLE_ID = "infra-styles";

/**
 * 把插件样式注入 document.head；同一文档内只注入一次。
 * @returns 无；重复调用（组件重挂载）幂等。
 */
export function ensureStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID) !== null) return;
  const element = document.createElement("style");
  element.id = STYLE_ID;
  element.textContent = styleText;
  document.head.appendChild(element);
}
