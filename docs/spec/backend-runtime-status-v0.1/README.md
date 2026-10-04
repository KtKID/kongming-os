# Backend Runtime Status v0.1

> 状态：方案确认中
> 目标：为 kongming-agent 提供统一的后端运行态视图，准确回答进程、cell、连接、活跃 session 和多 tab 关系

## 系统目标

当前仓库已经有分散的运行态观测点：

- `src/web/ctl.py` 能看 Web 进程是否存活
- `ThreadManager.list_cells()` 能看活跃 cell
- `/ws/thread-status`、`/ws/cron`、approval broadcaster、per-thread fanout 都各自持有连接计数
- Claude/Codex 还有独立的活跃 session 表

这些信息分散在不同对象和不同页面里。用户要回答“当前后端有多少链接”“一个 tab 算几条链接”“两个 tab 打开同一 thread 到底是几个 cell”时，需要手工拼接代码路径。

`backend-runtime-status-v0.1` 的目标是把这些运行态收敛成一份统一快照，并提供两个消费面：

- Web 管理页里的状态面板
- CLI 风格的状态输出

## 范围边界

**包含**：

- 统一术语：`cell` / `connection` / `session` / `tab`
- server 侧运行态快照模型
- 当前各类链接的链路定义与多 tab 语义
- 统一聚合服务与 REST 接口
- 基于同一快照的 CLI 输出
- Web 状态页展示

**不包含**：

- 新建专用 `/ws/manage-status` 长连接
- 外部代理、负载均衡、浏览器 TCP 层面的网络连接统计
- provider 内部 HTTP socket pool 的精确观测
- workflow dashboard 的 stage 进度可视化
- 自动修复、自动扩缩容、告警通知

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| A. Snapshot Semantics | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#模块-a-snapshot-semantics) | 是 | 先统一术语和计数口径 |
| B. Runtime Collectors | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#模块-b-runtime-collectors) | 是 | 连接计数从现有对象取数 |
| C. Aggregation API | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#模块-c-aggregation-api) | 是 | 统一快照服务和 REST 出口 |
| D. CLI Surface | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#模块-d-cli-surface) | 是 | CLI 与 Web 共用同一快照 |
| E. Web Status Page | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md#模块-e-web-status-page) | 是 | 首版沿用现有 `/manage` 与轮询 |

## 文档导航

- [目标与边界](./01-goals-and-boundaries.md)
- [模块拆分](./02-module-breakdown.md)
- [核心链路](./03-core-workflows.md)
- [数据与状态](./04-data-and-state.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 先把 server 侧原始计数定义成唯一真值，避免页面和 CLI 各自推导。
2. v0.1 不增加新的专用 WebSocket，状态页继续复用当前页面固定连接模型。
3. `03-core-workflows.md` 里的每条链路图可以直接作为 x-req 的输入。
4. 模块 A、B、C、D 已经具备进入 x-req 的条件。
5. 模块 E 在 A、B、C 的快照字段冻结后进入 x-req 最稳妥。
