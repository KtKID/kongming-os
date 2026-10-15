/**
 * MadeMe 配置表单的浏览器样式：以 DSH 设置表单的排版规范（ui-primitives
 * settings-form 与 ui-settings-subagent 的 module.css）为准——字段行
 * padding 12px 0、行间 0.5px 分隔线、正文 13px/1.5、辅助 12px 三级色。
 * 客户端构建是 esbuild 单文件 bundle（不支持 css module），样式经
 * ensureStyles() 以 <style> 注入一次，class 一律加 mademe- 前缀避免与
 * 宿主样式冲突。
 */

/** 全部表单附加样式；属性名与取值对齐 DSH --dsw-* token 体系。 */
const styleText = `
.mademe-field {
  display: grid;
  gap: 6px;
  padding: 12px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.mademe-toggle-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.mademe-toggle-label {
  flex: 1;
  min-width: 0;
  font-weight: 500;
}
.mademe-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}
.mademe-health {
  display: grid;
  gap: 4px;
}
.mademe-health-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
.mademe-health-fail {
  color: var(--dsw-alias-state-error-primary);
}
`;

const STYLE_ID = "mademe-config-styles";

/**
 * 把表单样式注入 document.head；同一文档内只注入一次。
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
