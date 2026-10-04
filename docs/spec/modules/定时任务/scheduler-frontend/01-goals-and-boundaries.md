# 01 Goals And Boundaries

## 目标

1. 建立独立的前端定时任务模块，代码根目录固定为 `web/src/modules/scheduler/`
2. 提供明确的用户入口：顶部按钮“定时任务”打开右侧抽屉
3. 抽屉内提供任务列表、基础状态、任务操作、底部创建按钮
4. 创建任务走结构化表单，避免让前端表单耦合到 LLM 工具入参细节
5. 前端采用按需刷新策略：打开抽屉、操作成功、窗口重新聚焦时刷新
6. 保持壳层可替换，为后续全局浮动面板或独立页面保留演进空间

## 本版包含

- Header 入口按钮
- 右侧抽屉壳层
- 任务列表
- 任务详情区
- 创建定时任务弹窗
- 任务基础操作：暂停、恢复、立即执行、删除
- 按需刷新
- 后端创建任务 REST 入口

## 本版不含

- 全局常驻 `/ws/cron`
- 抽屉内定时轮询
- 多 tab 强一致实时同步
- 任务编辑
- 批量操作
- 高级日志浏览器
- 审计事件时间线 UI
- 模块依赖 lint 自动检查实现

## 边界规则

### 前端模块边界

- `web/src/modules/scheduler/` 持有 scheduler 全部业务状态和业务组件
- 外部模块只导入 `@/modules/scheduler` 的公开导出
- `Layout.tsx` 只负责挂载入口按钮和抽屉宿主
- 路由层后续如增加 `/scheduler` 页面，页面壳也只从 `@/modules/scheduler` 导入

### 禁止跨模块函数式调用

- scheduler 模块不直接调用 `threads`、`chat`、`workspace`、`workflow` 的 store action
- scheduler 模块不直接 import 其他业务模块内部组件
- scheduler 模块与外界交换数据的方式固定为 REST、props、route 参数、浏览器生命周期事件

### 共享依赖白名单

- `@/components/ui/*`
- `@/lib/api`
- `@/lib/utils`
- `@/protocol`
- `zustand`
- `react-router-dom`，仅入口壳层使用

## 完成定义

达到以下条件即满足本 spec：

1. 模块代码集中在 `web/src/modules/scheduler/`
2. Layout 顶部存在“定时任务”按钮
3. 点击按钮打开右侧抽屉并显示任务列表
4. 抽屉打开时触发任务加载
5. 新建任务通过结构化 REST 成功落库
6. 任务操作成功后自动刷新
7. 窗口重新聚焦且抽屉打开时补一次刷新
8. 调度功能运行时不依赖全局 `/ws/cron` 常驻连接
