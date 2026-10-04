# 司天 v1

> 状态：可拆 task
> 目标：主动扫描指定路径，沉淀工作区全局状态到 `SiTianRecords`，基于状态给出下一步建议

## 系统目标

司天 v1 是一个工作区级观察者系统。它通过配置声明观察源，主动扫描通用频道、Claude 项目、Codex 项目相关路径，把扫描结果写入 `SiTianRecords`，再基于全局状态生成建议、阻塞判断和风险提醒。

## 范围边界

**包含**：

- 配置化声明观察路径和数据源
- 主动扫描状态文件、摘要文件、白板文件、线程元数据
- 写入 `SiTianRecords`
- 维护全局 `workspace state`
- 生成建议、阻塞、风险结论

**不包含**：

- 事件订阅与实时推送
- 自动启动、暂停、推进 workflow
- 全工作区隐式自动发现
- 对执行 agent 的 workflow 控制

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| 观察源配置 | 可进入 x-req | `./02-module-breakdown.md` | 是 | 定义观察路径、扫描周期、过滤规则 |
| 主动扫描器 | 可进入 x-req | `./02-module-breakdown.md` | 是 | 主动遍历路径并提取事实 |
| 司天录存储 | 可进入 x-req | `./04-data-and-state.md` | 是 | 物化 observations、state、suggestions |
| 建议引擎 | 可进入 x-req | `./03-core-workflows.md` | 是 | 基于状态生成建议、阻塞、风险 |
| 控制面展示 | 方案确认 | `./03-core-workflows.md` | 否 | 提供读取与展示适配 |

## Spec 导航

| Spec | 状态 | 说明 |
|------|------|------|
| [prompt-inject](./prompt-inject/) | 可进入 x-req | workspace_state 注入 system prompt，给 agent 跨项目视野 |

## 文档导航

- [模块拆分](./02-module-breakdown.md)
- [Task 映射](./90-task-map.md)
- [核心流程](./03-core-workflows.md)
- [数据与状态](./04-data-and-state.md)

## 当前建议

1. 先落地“主动扫描 + 状态物化 + 建议输出”主链路。
2. 先让观察源配置、主动扫描器、司天录存储、建议引擎进入 `x-req`。
3. 控制面展示继续留在方案层，等状态模型稳定后再进入开发。
