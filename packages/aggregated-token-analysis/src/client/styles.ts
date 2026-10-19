/**
 * 聚合 Token 分析面板与表单的浏览器样式。颜色与圆角一律取主题变量
 * （--dsw-*），不写字面量；面板无工具栏，只有视口、居中加载态与超时
 * 提示条。客户端构建是 esbuild 单文件 bundle（不支持 css module），
 * 样式经 ensureStyles() 以 <style> 注入一次，class 一律加 token-analysis-
 * 前缀避免与宿主样式冲突。布局数值（提示条内边距、视口最小高度）对齐
 * kmh-infra 的同类面板。
 */

/** 全部附加样式；属性名与取值对齐 DSH --dsw-* token 体系。 */
const styleText = `
.token-analysis-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.token-analysis-notice {
  margin: 0;
  padding: 6px 10px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  font-size: 12px;
  line-height: 1.6;
}
.token-analysis-notice-url {
  display: block;
  overflow: hidden;
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  max-width: 720px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.token-analysis-frame {
  display: block;
  flex: 1;
  width: 100%;
  min-height: 240px;
  background: var(--dsw-alias-bg-base);
  border: none;
}
.token-analysis-centered {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
`;

const STYLE_ID = "token-analysis-styles";

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
