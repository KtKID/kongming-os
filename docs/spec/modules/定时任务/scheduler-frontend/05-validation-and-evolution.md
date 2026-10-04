# 05 Validation And Evolution

## 验证清单

### 后端验证

- `POST /api/cron/tasks` 创建成功
- 参数缺失时返回明确 4xx
- `GET /api/cron/tasks` 与创建结果一致
- pause / resume / run_now / delete 的 REST 结果稳定

### 前端验证

- 顶部按钮可打开抽屉
- 抽屉首次打开触发任务加载
- 底部按钮可打开创建弹窗
- 创建成功后列表刷新并选中新任务
- 任务操作按钮可驱动暂停、恢复、立即执行、删除
- 窗口重新聚焦且抽屉打开时会补一次刷新
- Layout 不建立全局 `/ws/cron` 连接

### 测试层建议

- `api.ts` 单元测试
- `store.ts` 状态变迁测试
- `CreateSchedulerTaskDialog` 组件测试
- `SchedulerDrawerHost` 集成测试
- “打开抽屉 / 操作成功 / focus 回来”三类刷新触发器测试

## 演进路线

### v0.2

- 右侧抽屉
- 列表 + 详情 + 创建
- 按需刷新
- 基础操作

### v0.3

- 手动刷新按钮
- “上次刷新时间”提示
- 选中任务详情接口细化

### v0.4

- 全局浮动面板
- 拖拽与位置持久化
- 可切换抽屉壳和浮动壳

### v0.5

- 任务编辑
- 高级筛选
- 审计日志浏览

### 可选增强

- 只有在真实出现“长时间打开抽屉且必须秒级更新”的需求后，再评估 drawer-scoped `/ws/cron`
- 如果引入 WS，连接作用域只绑定抽屉可见期，不再绑定 `Layout`

## 风险

1. 多 tab 场景下，后台任务刚完成时，未重新聚焦的 tab 仍可能显示旧数据
2. 如果用户长时间打开抽屉但没有任何交互，状态刷新会滞后到下次聚焦或手动动作
3. 任务列表和运行记录都走全量或半全量刷新时，需要留意大任务量下的响应成本
4. 第一版优先稳定性，弱化了秒级实时感知

## 依赖约束规则草案

后续 lint 规则按以下约束实现：

- `modules/scheduler/components/**` 只允许导入本模块文件和共享 UI/工具层
- `modules/scheduler/store.ts` 只允许导入本模块文件与 `zustand`
- `modules/scheduler/api.ts` 只允许导入本模块类型与共享 API 工具
- 禁止导入 `@/stores/chat`、`@/stores/threads`、`@/stores/workspace` 等其他业务 store
