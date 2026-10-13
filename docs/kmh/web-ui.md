---
description: Kongming 自有插件在 DSH Web 上的界面规范：必须复用 DSH ui-primitives 组件与 dsw 主题 token、插件 client 无 CSS 文件通道下的布局方式、依赖接线、plugins.item 槽位 view 协议与明暗主题验证。
---

# 插件 Web 界面规范

Kongming 自有插件接入 DSH Web（接入步骤见[包接入指南](adding-a-plugin-package.md)）后，界面必须复用 DSH 宿主的 UI 组件与主题 token，保持与宿主一致的外观。本页只规定 Kongming 侧的强制约束与接线方式；样式职责、token 规则与组件语义的权威定义在 DSH 子模块，文末[权威归属](#权威归属)链接。

## 强制规则

1. **控件一律复用 [ui-primitives 组件目录](../../third_party/dsh/packages/client/ui-primitives/README.zh.md#component-catalog)。** 插件之间无法导入彼此的组件，该包是控件唯一可以共享的地方；有意的视觉差异提升为该组件的一个 prop，禁止复制一份组件改样式（[上游规则原文](../../third_party/dsh/docs/web-styling.zh.md#component-rules)）。
2. **颜色、圆角、间距、阴影使用 `--dsw-alias-*` 语义 token。** token 归 [ui-theme](../../third_party/dsh/packages/client/ui-theme/README.zh.md) 所有；禁止颜色字面量、复制静态色板值或另定义全局主题。
3. **禁止引入第三方组件库或 CSS 框架**（如 Tailwind）；上游对功能包同样禁止。
4. **样式只能来自组件包与内联 style。** 插件 client 经 Web 加载器只交付 JS（client 产物仅匹配 `client.*.js`，见 [client/modules](../../third_party/dsh/packages/client/modules/src/index.ts) 的加载清单），没有 CSS 文件通道；布局用内联 style 传递组件局部值，不得试图附带样式表。

## 依赖与导入

包 `dependencies` 声明 `@deepseek-ai/dsh-client-ui-primitives` 版本，`devDependencies` 以 `link:` 指向子模块源码以便本地联动；现行写法参考 [kmh-team/package.json](../../packages/kmh-team/package.json) 与 [codex-cli/package.json](../../packages/codex-cli/package.json)。client 源码从该包导入组件：

```ts
import { Modal, Button } from "@deepseek-ai/dsh-client-ui-primitives";
```

## plugins.item 槽位与 view 协议

挂载到 `plugins.item` 槽位的组件会收到 [`view: 'summary' | 'page'`](../../third_party/dsh/packages/client/ui-plugin-manager/src/client/slot-contract.ts) 请求：`summary` 渲染单行摘要，`page` 渲染完整表单。组件必须按 `view` 分支，否则摘要与详情页会把同一内容渲染成两份卡片——codex-cli 的 DetailCard 曾因此返工。

## 验证

- 每种颜色在明、暗两个主题下检查可读性；token 已做双主题适配，颜色字面量没有。
- client 源码改动后重启 web 才会生效（加载器按构建产物交付，无 HMR）。
- 界面设计判断（反馈面选择、浮层与菜单安全、加载态、错误文案位置）参照 DSH 的 [dsh-client-ui-ux 技能](../../third_party/dsh/.agents/skills/dsh-client-ui-ux/SKILL.md)，接入说明见[技能接入](skills.md)。

## 权威归属

- [Web 样式规则](../../third_party/dsh/docs/web-styling.zh.md)：样式职责归属与组件规则原文。
- [ui-primitives 组件目录](../../third_party/dsh/packages/client/ui-primitives/README.zh.md#component-catalog)：全部可复用控件及各自语义。
- [圆角规范](../../third_party/dsh/docs/ui-radius.zh.md)：圆角尺度与组件尺寸映射。
- [ui-theme](../../third_party/dsh/packages/client/ui-theme/README.zh.md)：`--dsw-*` token 清单与明暗主题。
