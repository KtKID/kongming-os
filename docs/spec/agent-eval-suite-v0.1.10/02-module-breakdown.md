# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|---|---|---|---|---|
| Test Domain Model | 定义 case / grader / report 的统一数据契约 | 无 | 可进入 x-req | 统一语言层 |
| Deterministic Harness | 跑 `stub` 与 `replay` case，产出稳定断言结果 | Test Domain Model, Runtime 主链 | 可进入 x-req | 回归主力 |
| Trace + Artifact Graders | 对事件流、session、文件产物做结构化判分 | Test Domain Model | 可进入 x-req | 对齐当前 trace-first 架构 |
| Smoke Harness | 跑少量真实 provider / web / scheduler 冒烟 | Deterministic Harness | 可进入 x-req | 保留真实链路验证 |
| Report Aggregation | 汇总 case 粒度结果并输出回归报告 | Test Domain Model, Graders | 可进入 x-req | 供 CI 和人工阅读 |

## 模块详情

### 模块 A：Test Domain Model

**职责**：给整套测试集定义统一语言，让 case、执行记录、grader、报告都能共享同一份协议。

**包含范围**：

- `CaseSpec`
- `ExecutionLane`
- `Expectation`
- `ExecutionRecord`
- `GraderResult`
- `SuiteReport`

**不包含范围**：

- 真正的 runtime 执行逻辑
- 业务型 benchmark 数据
- 外部公共 leaderboard 适配

**为什么它先做**：

当前仓库已经有大量单测和 e2e。缺口不在“完全没有测试”，缺口在“没有统一的系统级 case 语言”。先把语言钉死，后面的 harness 和报告才不会漂。

### 模块 B：Deterministic Harness

**职责**：执行不依赖真实外部模型波动的回归 case。

**包含范围**：

- stub LLM 脚本执行
- replay provider 响应回放
- 固定 approval script
- 固定 tool fixture
- trace / session / artifact 收集

**不包含范围**：

- 在线大模型真实响应
- 浏览器真人交互
- 压力测试

**为什么它重要**：

当前框架的大部分关键风险都在系统语义：turn 计数、tool 回填、approval 分流、session 持久化、trace 完整性。这些问题都适合用确定性 harness 守住。

### 模块 C：Trace + Artifact Graders

**职责**：把“是否通过”从结果文本扩展到状态和证据。

**包含范围**：

- event sequence grader
- event payload grader
- session JSONL grader
- prompt-debug grader
- file artifact grader
- semantic output grader

**不包含范围**：

- 再跑一遍 runtime
- 人工 UI 审核工具

**为什么它贴合当前框架**：

当前仓库已经把 `trace.jsonl`、`prompt-debug`、`session JSONL`、`web thread file` 做成事实源。测试集应该直接消费这些事实源，而不是只盯最终回复。

### 模块 D：Smoke Harness

**职责**：对真实链路做少量高价值验证。

**包含范围**：

- 本地或在线 provider 冒烟
- streaming 冒烟
- web thread lifecycle 冒烟
- scheduler / evolution 后台链路冒烟

**不包含范围**：

- 大规模探索式试跑
- 不稳定第三方服务的持续压测

**为什么它单独成层**：

真实链路的价值是验证“装配真的连起来了”。真实链路的成本和波动也更高，所以它适合做窄集，不适合做主回归集。

### 模块 E：Report Aggregation

**职责**：把零散测试结果收口成系统级报告。

**包含范围**：

- case 粒度报告
- suite 汇总
- lane 维度通过率
- flaky 标记
- artifact 路径索引

**不包含范围**：

- CI 编排
- 图形化 dashboard

**为什么需要它**：

当前测试文件很多，阅读成本高。统一报告能直接回答三个问题：

- 哪个能力面坏了
- 坏在 deterministic 还是 smoke
- 对应证据文件在哪里
