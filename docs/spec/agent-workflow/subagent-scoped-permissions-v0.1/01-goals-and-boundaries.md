# 目标与边界

## 目标

1. 子 agent 默认只能在自己的 `working_dir` 内 read / write / list。
2. 主 agent 创建子 agent 时显式选择 `tool_names`、`skill_names` 和 `permission`。
3. `SubAgentManager` 维护每个子 agent 的授权单，并把授权传给运行时审批 wrapper。
4. 子 agent 工具调用进入现有审批链前先做 scoped grant 判断。
5. 子 agent 创建和审批结果完整写入 workflow 审计目录。

## 完成标准

- 每个子 agent 创建后都有 `agents/<task_run_id>/subagent.json`。
- `audit.jsonl` 至少记录 `subagent_created`、`subagent_grant_bound`、`subagent_approval_decided`。
- 每次子 agent 触发工具审批都写入 `<workflow_dir>/audit.jsonl`。
- 子 agent 会话 JSONL 只用于原始对话回放，权限审计以 workflow `audit.jsonl` 为准。
- `write_file` 写入 `working_dir/result.txt` 自动允许。
- `write_file` 写入 `../outside.txt` 直接拒绝。
- `read_file` 读取 `working_dir` 内文件自动允许。
- `read_file` 读取项目源码直接拒绝。
- 子 agent 未授权工具调用直接拒绝。
- 审计事件能通过 `workflow_id`、`subagent_id`、`grant_id` 串起来。

## 范围内

- 子 agent 创建时授权。
- 子 agent 自己工作目录内的 read / write / list 放行。
- 路径 resolve + `relative_to(working_dir)` 校验。
- 子 agent 审批 wrapper。
- 完整创建日志和审批日志。
- 单元测试和 CLI e2e 验证。

## 范围外

- workspace 源码读授权。
- workspace 源码写授权。
- shell / network 放行。
- 凭据路径读取。
- 子 agent 运行中请求主 agent 二次审批。
- Web UI 渲染。

## 关键约束

- `core.contracts.ApprovalProvider` 协议保持不变。
- `src/core/` 保持零 sibling 依赖。
- `SubAgentManager` 是子 agent 权限维护边界。
- `AgentWorkflowManager` 负责 workflow 目录和审计文件。
- `AgentWorkflowTool` 只负责主 agent 可见 schema 和参数解析。
- 子 agent 的默认路径由系统分配，主 agent 不传任意绝对工作目录。
- 权限事实源固定在 workflow 审计目录，Web 后续从 workflow 审计投影。

## MVP 权限矩阵

| 操作 | 默认结果 | 说明 |
|------|----------|------|
| `read_file` 读取 `working_dir` 内文件 | allow | 子 agent 可读取自己的产物 |
| `write_file` 写入 `working_dir` 内文件 | allow | 子 agent 可写报告、草稿、临时文件 |
| `list_dir` 查看 `working_dir` | allow | 子 agent 可检查自己的产物 |
| 读取 workflow 其他 agent 目录 | reject | 第一版隔离每个子 agent |
| 读取项目源码 | reject | 需要上下文时由主 agent 放入 `context` |
| 写项目源码 | reject | 修改项目由主 agent 执行 |
| shell / network | reject | 第一版关闭高风险能力 |
| 未在 `tool_names` 内的工具 | reject | 工具白名单优先 |

## 设计判断

第一版把权限压到工作目录内，能覆盖拆分任务、计算、写报告、生成草稿文件和审查摘要。需要项目上下文的任务由主 agent 提前裁剪后放入 `context`，子 agent 保持最小信息面。
