# @kmh/web-surface-zh

将 web-app 注入的 `app:web-surface` 系统提示词段落替换为中文文案。上游 `@deepseek-ai/dsh-web-app` 以英文 `webSurfacePrompt()` 生成该段落并经 `systemPrompt.section()` 注册；本插件监听 `system-prompt/assemble` 瀑布，在组装完成后按段落名替换文本，DSH 源码零改动，`DSH_WEB_URL` 环境变量与 `harness-source` 段落不受影响。链路溯源与方案取舍见 [spec 记录](../../docs/kmh/README.md)。

## 使用本包

挂载于 `profiles/kmh-web/cordis.patch.yml` 顶部 insert 区：

```yaml
- id: kmh-web-surface-zh
  name: "@kmh/web-surface-zh"
```

配置只有一个可选键 `text`：自定义文案模板，留空使用内置中文文案；模板中的 `{url}` 占位符在每次组装时填入从上游原文案提取的 GUI 地址（跟随端口与 `publicUrl` 变化）。

修改配置或文案后重启 `pnpm web` 生效；`pnpm config:web` 查不到该段内容，验证走新会话提问或会话 raw 检阅。

## 开发备注

- 上游段落名固定为 `app:web-surface`；未命中（如 `surfaceContext: false` 或上游改名）时记一条 warn 并保留英文原文，不阻断组装。
- 中文文案不含 `{{ }}` 引用，避免落入系统提示词的严格变量插值；地址回填在文本层面完成。
- 纯函数 `replaceWebSurface` 承载全部替换逻辑，由 `tests/runtime/web-surface-zh.test.mjs` 直接覆盖；`pnpm build:kmh` 构建本包。
