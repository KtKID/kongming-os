# codex-web-integration v0.1

> 状态：方案确认中
> 目标：在 kongming-agent web 上加一个 Codex 接入通道，与 Claude Code 通道平级，让前端可以在两个 agent 之间自由切换。

## 系统目标

复用 `src/web/integrations/claude_code/` 已经沉淀的"协议中立"抽象（`SessionManager` / `NormalizedMessage` / 前端渲染层 / 项目扫盘 / 历史回放），把 OpenAI Codex CLI 接成 web 后端可调起的另一个 agent runtime，验证抽象的 provider-中立性，并打开未来接入 Gemini / Cursor 的同构路径。

**为什么要做**：

- 用户日常已经在用 codex 桌面端 + Claude Code，希望单一 web UI 同时驾驭两个 agent
- 验证现有 `llm_protocol.py` 已经预留的 `LLMProvider = Literal["claude", "codex", "gemini", "cursor"]` 这条约定的实战可行性
- 未来同构接入 Gemini / Cursor 时直接照抄本方案的模板

## 范围边界

**包含（v0.1）**：

- 后端：新增 `src/web/integrations/codex/` 包，6 文件同构 claude_code（service / normalizer / approval / projects_scanner / jsonl_history / route）
- spawn `codex exec --json` 子进程驱动，stdout jsonl 行解析为 `NormalizedMessage` 流回前端
- 会话生命周期：新建 / 续话（`codex exec resume <sid>`）/ 中止 / 列表
- 历史回放：解析 `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl` 第一行 `session_meta` + 后续 `event_msg` 还原 `NormalizedMessage[]`
- 项目浏览：扫描 `~/.codex/sessions/` 树（兜底）+ 复用 `~/.codex/session_index.jsonl`（OpenAI 维护的索引，有写入延迟）
- 前端：复用 `NormalizedMessage` 渲染层；UI 上把 Codex 作为与 Claude 并列的 provider 选项；权限控制三档 dropdown（参考 ccui）
- 单元测试：`tests/unit/web/integrations/codex/` 覆盖 normalizer / projects_scanner / jsonl_history

**不包含（v0.1，明确排除）**：

- Per-call 审批 UI（exec 模式不暴露这个事件流，桌面端那种弹窗是 `app-server` 模式专属，本方案不模拟）
- Node sidecar 路线 / `openai-agents` Python SDK 路线（已比选否定）
- Codex MCP 配置 UI（编辑 `~/.codex/config.toml`，留 v0.2）
- 跨 provider 的 thread 互通 / 历史合并（每 provider 独立会话空间）
- 安装 codex CLI（用户自己装，文档说明依赖）
- e2e Playwright 自动化测试（claude_code 那边也欠着，对齐处理）
- 前端填 API key（用户已 ChatGPT OAuth 登录态，仅读系统）

## 与 claude_code 通道对照

| 维度 | claude_code v0.2 | codex v0.1 | 差异点 |
|---|---|---|---|
| 进程模型 | `claude_agent_sdk` Python 同进程嵌入 | spawn `codex` CLI 子进程 | Codex 没官方 Python SDK，CLI 是最直路径 |
| 启动入口 | `ClaudeSDKClient(...)` + `client.query(...)` | `asyncio.create_subprocess_exec("codex", "exec", "--json", ...)` | 子进程封装；stdin 写 prompt 后关闭 |
| 事件流 | SDK message 对象（AssistantMessage / ToolUseBlock 等） | stdout jsonl 行（thread.* / turn.* / item.*） | normalizer 走两套类型，kind 出口一致 |
| 审批 | `can_use_tool` per-call 同步回调，三按钮 UI | 启动期 sandbox + approvalPolicy 配置，三档 dropdown | exec 模式无 per-call hook |
| 续话 | `options["resume"] = sid` | `codex exec resume <sid>` 子命令 | CLI 走子命令路径 |
| cwd 传递 | `options["cwd"]` | `--cd <DIR>` flag | — |
| 会话持久化 | `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` | `~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<ISO>-<sid>.jsonl` | Codex 多入口共享（桌面端 + CLI + SDK） |
| cwd 反推 | 目录名编码不可逆，要读 jsonl entry 字段 | rollout 第一行 `session_meta.payload.cwd` 真值 | Codex 优势 |
| API key | env | `~/.codex/auth.json` OAuth + `CODEX_API_KEY` env | 用户态由 codex 自管，web 不介入 |
| WebSocket 端点 | `/ws/claude-code` | `/ws/codex` | 平级隔离 |

## 关键事实（实测，2026-05-04）

**codex CLI 版本**：`codex-cli 0.128.0`（`npm i -g @openai/codex`）

**stdout `--json` 4 类事件**：

```json
{"type":"thread.started","thread_id":"019dee38-c689-7341-9011-d8cd06e8aeca"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hello"}}
{"type":"turn.completed","usage":{"input_tokens":24053,"cached_input_tokens":6016,"output_tokens":30,"reasoning_output_tokens":23}}
```

事件家族：`thread.started` / `turn.{started,completed,failed}` / `item.{started,updated,completed,failed}`，`item.type` 子类型 8 种（agent_message / reasoning / command_execution / file_change / mcp_tool_call / web_search / todo_list / error）。

**rollout jsonl 落盘**：每行 `{timestamp, type, payload}`，4 类顶层 type：
- `session_meta` × 1（**第一行**含 id / cwd 真值 / originator / cli_version / source / model_provider / base_instructions）
- `turn_context` × per-turn（含 turn_id / cwd / approval_policy / sandbox_policy / model / effort）
- `event_msg` × per-event（payload.type 与 stdout `--json` 同源，**复用同一套 normalizer**）
- `response_item` × per-item（OpenAI Responses 内部状态，历史回放**不需解析**）

**红线**：`~/.codex/` 是用户**正在用桌面端**的数据（210MB sqlite + 100+ 历史 rollout）。web 后端：
- ✅ 只读扫盘列会话
- ✅ 新建会话写新 rollout（codex 子进程自己写，我们不动）
- ❌ **不许**写 / 改 / 删既有 rollout、`session_index.jsonl`、`config.toml`、`auth.json` 任意一项

详细事件 schema、参数、续话机制见 `01-architecture.md` 和 `02-protocol.md`。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|---|---|---|---|---|
| service | 方案确认 | `01-architecture.md#service` | ✅ | spawn 子进程 + jsonl 行 reader + abort |
| normalizer | 方案确认 | `01-architecture.md#normalizer` | ✅ | event → NormalizedMessage 一对一映射 |
| approval | 方案确认 | `01-architecture.md#approval` | ✅ | v0.1 仅做 mode → sandbox+approval-policy 转换 |
| projects_scanner | 方案确认 | `01-architecture.md#projects_scanner` | ✅ | 扫盘 + session_index 兜底 |
| jsonl_history | 方案确认 | `01-architecture.md#jsonl_history` | ✅ | 解析 rollout jsonl 还原 NormalizedMessage[] |
| route | 方案确认 | `01-architecture.md#route` | ✅ | `/ws/codex` + `/api/codex/*` 端点 |
| 前端 ProviderTabs / CodexView | 方案确认 | `01-architecture.md#frontend` | ✅ | 与 ClaudeCodeView 平级，复用 NormalizedMessage 渲染 |
| thread metadata schema 升级 | 方案确认 | `02-protocol.md#metadata` | ✅ | 当前实现写 schema v6，字段为 claude_thread_id + codex_thread_id + cwd |

## 文档导航

- [01-architecture](./01-architecture.md) — 模块架构与文件分工
- [02-protocol](./02-protocol.md) — WebSocket / REST 协议契约
- [03-data-flow](./03-data-flow.md) — 数据流时序图
- [04-task-map](./04-task-map.md) — task 拆分与开发顺序

## 当前建议

1. **方案稳定，可进入 x-req**：所有模块都已实测 + 决策对齐，下一步把 `04-task-map.md` 中每个 task 通过 x-req 落成 `dev-pipeline/tasks/codex-web-integration-*/README.md`
2. **开发顺序锁定**：T1 backend-skeleton（service + normalizer + route 主链路）→ T2 history-resume（jsonl_history + projects_scanner + schema v4）→ T3 frontend（ProviderTabs + CodexView + 三档 dropdown）→ T4 unit-tests
3. **跨 task 共享前置**：`llm_protocol.py` 重命名 `ClaudeCommand` → `CodexCommand`/`ClaudeCodeCommand`（或保持鸭子类型由 `type` 字段区分）—— 决策点见 `02-protocol.md#cross-task`
4. **风险登记**：codex CLI 0.128.0 jsonl schema 仍在演进（参考 issue #14736），normalizer 必须宽容解析（unknown type 走 raw_dump）

---

*spec 完成时间：2026-05-04*
*关联实测脚本：`/tmp/codex_demo.jsonl` `/tmp/codex_approval.jsonl`（一次性 demo，未保留）*
