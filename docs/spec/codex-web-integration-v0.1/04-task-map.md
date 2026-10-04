# 04 · Task 映射

## Task 拆分

按 v0.1 范围（README.md `## 范围边界`）拆 4 个 task，串行依赖关系，可两条并行（T2 可与 T3 部分并行）。

| Task | 范围 | 依赖 | 状态 | 推荐顺序 |
|---|---|---|---|---|
| `codex-web-backend-skeleton-v0.1` | service / normalizer / approval / route + `CodexCommand` 加 + `SessionManager` move + 主链路打通 | 无 | 可进 x-req | T1 |
| `codex-web-history-resume-v0.1` | jsonl_history / projects_scanner / REST 端点 / thread metadata schema v3→v4 | T1 完成（要用同款 normalizer） | 可进 x-req | T2 |
| `codex-web-frontend-v0.1` | ProviderTabs / CodexView / CodexPermissionMode / CodexProjectList | T1 完成（ws 协议落地）；与 T2 部分并行 | 可进 x-req | T3 |
| `codex-web-unit-tests-v0.1` | tests/unit/web/integrations/codex/ 覆盖各模块 | T1+T2 完成 | 可进 x-req | T4 |

**总规模**：后端 ~1500 行 + 前端 ~600 行 + 测试 ~500 行 = **~2600 行**，与 claude-code-web v0.1 + v0.2 总量相当。

## Task 详情

### T1: `codex-web-backend-skeleton-v0.1`

**目标**：把 codex 主链路跑通——前端发命令，后端 spawn codex 子进程，事件流回前端，前端能看到 text/tool_use/tool_result/complete。

**包含**：

- `src/web/integrations/codex/__init__.py` — 公共入口
- `src/web/integrations/codex/service.py` — spawn + stdout reader + abort
- `src/web/integrations/codex/normalizer.py` — codex jsonl event → NormalizedMessage（覆盖 §02-protocol §2.1 全表）
- `src/web/integrations/codex/approval.py` — `map_permission_mode()`
- `src/web/integrations/codex/route.py` — `/ws/codex` + 4 类入站消息分发
- `src/web/app_support/llm_protocol.py` — 新增 `CodexCommand` TypedDict
- `src/web/shared/__init__.py` + `src/web/shared/session_manager.py` — 从 claude_code 迁移
- `src/web/integrations/claude_code/__init__.py` — 改 import 路径（破坏性，不留 shim）
- `src/web/app.py` — 注册新 ws 路由

**不包含**：

- 历史回放、jsonl 解析（→ T2）
- 项目扫盘（→ T2）
- thread metadata schema 升级（→ T2）
- 前端任何代码（→ T3）
- 单元测试（→ T4）

**完成标志**：手动用 `wscat` 或简单 html 页面连 `/ws/codex`，发 `codex-command`，能看到完整事件流（含 text + tool_use + tool_result + complete）。

**风险**：

- codex jsonl schema 演进（issue #14736）→ normalizer 必须宽容解析
- stdin 阻塞 → 子进程 stdin 必须显式写入 prompt 后关闭
- abort 时 SIGTERM 不一定 graceful → 需要 SIGKILL fallback

**预估 PR 行数**：~800 行（service 250 + normalizer 280 + approval 50 + route 200 + 共享 30）

---

### T2: `codex-web-history-resume-v0.1`

**目标**：刷新页面后能恢复历史；能跨 cwd 浏览所有 codex 项目和会话。

**包含**：

- `src/web/integrations/codex/projects_scanner.py` — 扫 `~/.codex/sessions/` 树 + 复用 `session_index.jsonl`
- `src/web/integrations/codex/jsonl_history.py` — 解析 rollout-*.jsonl 还原 NormalizedMessage[]
- `src/web/routers/codex.py` — REST 端点（`/api/codex/projects` `/api/codex/sessions/{sid}/history` `/api/codex/sessions/{sid}/metadata`）
- thread metadata schema 升级链最终写回 v6（`claude_thread_id` + `codex_thread_id`，懒升级）
- `src/web/app.py` — 注册新 REST 路由

**不包含**：

- 前端调用 REST 的逻辑（→ T3）
- session_index.jsonl 写入（红线，禁止）

**完成标志**：

- `curl /api/codex/projects` 返回正确分组
- `curl /api/codex/sessions/<sid>/history` 返回历史 NormalizedMessage[]，结构与 ws 实时流完全一致（同一套 normalizer）
- 旧 v3 thread metadata 文件读盘后写入触发懒升级到 v6（`schema_version` 字段变化）

**依赖**：T1 完成（jsonl_history 要 import normalizer）

**风险**：

- 大 rollout 文件（>16 MB）流式读必须 aiofiles 按行
- session_index.jsonl 写入延迟 → 兜底扫盘必须存在
- schema v4 升级影响既有 claude_code thread → 严格保持向后兼容（既有字段不动，新字段 optional）

**预估 PR 行数**：~520 行（jsonl_history 220 + projects_scanner 200 + REST 50 + schema 升级 50）

---

### T3: `codex-web-frontend-v0.1`

**目标**：前端 UI 上能切换 Claude / Codex tab；Codex tab 下能选 cwd、选权限模式、发消息、看流、看历史。

**包含**：

- `web/src/components/ProviderTabs.tsx` — 顶部 tab 切换器
- `web/src/components/CodexView.tsx` — Codex 主视图（消息流 + 输入框 + permission dropdown）
- `web/src/components/CodexPermissionMode.tsx` — 三档 dropdown（default / acceptEdits / bypassPermissions）
- `web/src/components/CodexProjectList.tsx` — 项目浏览（复用 ClaudeProjectList 视觉，换数据源）
- `web/src/hooks/useCodexWebSocket.ts` — ws 连接 hook
- `web/src/api/codex.ts` — REST 调用封装
- `web/src/types/codex.ts` — TS 类型（参考 `llm_protocol.py`）
- 集成到 `web/src/App.tsx` 或主路由

**不包含**：

- e2e Playwright 测试（v0.2+）
- 前端单测（v0.2+，本项目目前 jest 覆盖薄）

**完成标志**：手动测：

1. 启动 web，看到 ProviderTabs，切到 Codex
2. 选一个项目，看到该项目的会话列表
3. 点开历史会话，看到回放消息
4. 输入新 prompt + 选 default 模式，发出，看到完整事件流
5. 切到 acceptEdits 模式，发会改文件的 prompt，能成功执行
6. 中途点 abort，看到 complete + aborted

**依赖**：T1 完成（ws 协议）+ T2 完成（REST 端点 + 历史）。但与 T2 部分并行：T1 完成后即可开始 mock REST 数据搭骨架，T2 完成后接真实数据。

**风险**：

- `MessageList` 组件原本只见过 claude provider 数据，codex 数据可能触发 edge case（unknown kind → 走 raw_dump 渲染就行）
- WebSocket 重连状态机要正确（参考既有 `useClaudeWebSocket`）

**预估 PR 行数**：~600 行（4 组件 + 1 hook + 1 api + 类型 + 集成）

---

### T4: `codex-web-unit-tests-v0.1`

**目标**：覆盖核心模块单测，CI 跑通。

**包含**：

- `tests/unit/web/integrations/codex/test_normalizer.py` — 14 种 kind 映射全覆盖 + unknown event 走 raw_dump
- `tests/unit/web/integrations/codex/test_approval.py` — 三档 mode → (sandbox, policy) 映射
- `tests/unit/web/integrations/codex/test_jsonl_history.py` — 用真实 fixture（用户机器现有 rollout）解析、跳过 response_item / session_meta
- `tests/unit/web/integrations/codex/test_projects_scanner.py` — 扫盘逻辑 + session_index 优先 + 兜底
- `tests/unit/web/integrations/codex/test_service.py` — mock subprocess，验证参数构造正确（spawn args list）+ abort 路径
- `tests/fixtures/codex/rollout-sample.jsonl` — 抽用户机器一份小 rollout（去敏感信息）

**不包含**：

- e2e（playwright，v0.2+）
- 真实跑 codex 的集成测试（消耗 token，CI 跑不动）

**完成标志**：

- `pytest tests/unit/web/integrations/codex/ -v` 全绿
- `make typecheck` 无新增错误
- `make lint` 无新增错误

**依赖**：T1 + T2 完成

**预估 PR 行数**：~500 行（5 个测试文件 + fixture）

#### 边界用例清单（提炼自 ccui 源码处理逻辑）

> **注**：ccui 项目本身**没有 codex 单元测试**（实测：`find` 命中全在 `node_modules/`），但 `server/openai-codex.js` 的 try/catch + abort + turn.failed 累积 + finally 状态机反映了他们踩过的边界。下表把这些边界提炼为我们 T4 必跑的测试用例。

**对应文件路径**：ccui `server/openai-codex.js:250-339` 主循环 + `:347-362` abort 函数。

| # | 场景 | 测试在哪个文件 | 预期行为 | ccui 参考行号 |
|---|---|---|---|---|
| 1 | abort 中途打断（事件循环检测 status='aborted'） | test_service.py | break 主循环 + 不再发后续事件 + complete{aborted:true} | :255-259 |
| 2 | abort 在 turn.completed 之后到达 | test_service.py | finally 设 status，不被 'completed' 覆盖 | :333-338 |
| 3 | `item.started` 不发到前端 | test_normalizer.py | 仅 `command_execution` 起步事件转发，其他 item.started/updated 跳过 | :261-263 |
| 4 | `item.updated` 不发到前端 | test_normalizer.py | 跳过中间态，避免重复 | :261-263 |
| 5 | turn.failed 累积只触发一次 | test_service.py | 首次记录 terminalFailure，后续 turn.failed 不重复 emit | :273-282 |
| 6 | codex CLI 未安装（spawn FileNotFoundError） | test_service.py | kind:error，content 含 "codex CLI not installed" + npm 安装指引 | :313-319 |
| 7 | codex 未登录（stderr 含 "Not authenticated"） | test_service.py | kind:error，content 含 "run `codex login`" | 03-data-flow.md §6 |
| 8 | jsonl 单行 parse 失败 | test_normalizer.py | 不抛错，单行 skip + 发 kind:error 含 raw line | 自定 |
| 9 | unknown event type（codex schema 演进） | test_normalizer.py | 不抛错，原样走 raw_dump → kind:error.content=raw | 自定（issue #14736） |
| 10 | 子进程 SIGTERM 后还有 stdout 残留 | test_service.py | 收尾读完 buffered + 发 complete{aborted:true} | :331-338 |
| 11 | 超大 rollout 文件流式回放（>16MB） | test_jsonl_history.py | 用 aiofiles 按行，内存峰值 < 50MB | 自定（实测有 16760579 字节文件） |
| 12 | rollout 中 `response_item` 跳过 | test_jsonl_history.py | 不影响回放结果，只解析 event_msg | 02-protocol.md §2.1 |
| 13 | rollout 中 `session_meta`（第一行）跳过 | test_jsonl_history.py | 不重复发 session_created（前端已通过 projects 拿过） | 自定 |
| 14 | session_index.jsonl 缺失 | test_projects_scanner.py | 兜底扫盘 ~/.codex/sessions/ 树照常工作 | 自定 |
| 15 | session_index.jsonl 写入延迟（最近会话不在索引） | test_projects_scanner.py | 兜底扫盘补齐 | 实测 30s 延迟 |
| 16 | 同一 session_id 重复 query 并发 | test_service.py | SessionManager 拒绝第二次 query，前端收 kind:error | 自定（red line 防桌面端冲突） |
| 17 | resume 已不存在的 session_id | test_service.py | codex 子进程 exit non-zero → kind:error | 自定 |
| 18 | empty stdout（codex 立即 exit） | test_service.py | 主循环不 hang，发 complete{exitCode} | 自定 |
| 19 | abort 错误判定（三条件 OR） | test_service.py | session.status=='aborted' / CancelledError / "aborted" 子串 任一即认为 abort | :305-308 |
| 20 | 三档 permission_mode 参数构造 | test_approval.py + test_service.py | spawn args list 含正确 `--sandbox` 和 `--config approval_policy=...` | 02-protocol.md §1.1 |
| 21 | cwd 含空格 / 中文路径 | test_service.py | spawn args 不需 quote（subprocess 自动），`--cd "/path with space"` 正确传 | 自定 |
| 22 | session_meta.cwd 优先于目录名反推 | test_jsonl_history.py + test_projects_scanner.py | jsonl 字段为真值；目录名只用做扫盘 | README.md §关键事实 |
| 23 | rollout 文件中途被 codex 写入（读时未完结） | test_jsonl_history.py | 不抛 EOFError，读到哪算哪（最后一条 turn 可能没 turn.completed） | 03-data-flow.md §5 |
| 24 | normalizer 收到含 INTERNAL_CONTENT_PREFIXES 文本 | test_normalizer.py | strip `<system-reminder>` 等内部块再发 text/thinking | 02-protocol.md §2.3 |
| 25 | thread metadata schema v3 → v6 懒升级 | test_thread_metadata.py（在 T2） | 旧 v3 file 读盘后补 usage / codex_thread_id，并把 sdk_session_id 改名为 claude_thread_id；写盘时升 v6 | 02-protocol.md §4.3 |

**Fixture 准备**：

- `tests/fixtures/codex/rollout-minimal.jsonl` — 用户机器现有 rollout 抽一份小的（< 100 KB），去敏感信息（替换真实 prompt 为 "test prompt"）
- `tests/fixtures/codex/rollout-with-tool-call.jsonl` — 含 command_execution + file_change + mcp_tool_call 的多 item rollout
- `tests/fixtures/codex/rollout-aborted.jsonl` — abort 后未完成的 rollout（最后 turn 无 turn.completed）
- `tests/fixtures/codex/session_index.jsonl` — 多条 mock 索引（含一条延迟未收录的，验证兜底）
- `tests/fixtures/codex/stdout-events.jsonl` — codex exec --json 的实时事件流样本（4 类事件全覆盖 + unknown event）

**约束**：

- fixture 文件**不放真实 cwd/auth/sensitive 内容**——抽样后用 `sed` 替换 `kid` 用户名为 `test`，替换具体 prompt 为占位
- fixture 大小不超过 150 KB（CI 仓库体积控制）

---

## 跨 task 共享决策（执行清单）

这些决策已在 `02-protocol.md §6` 锁定，作为 **T1 必须先做完**的前置：

1. **`CodexCommand` TypedDict** 加到 `src/web/app_support/llm_protocol.py`（T1 必带）
2. **`SessionManager` 迁移** 到 `src/web/shared/session_manager.py`（T1 必带，破坏性单文件迁移）
3. **`provider="codex"`** 已在 `LLMProvider` Literal 内，无需改
4. **schema v4 懒升级** 在 T2 做（T1 阶段 thread metadata 还可以是 v3，但创建 codex thread 时必须直接写 v4）

## 不进入 v0.1 的事项（v0.2+ 路线图）

- per-call 审批 UI（要看 codex `app-server` 协议，可能要走 SDK 双向通道）
- Codex MCP 配置 UI（编辑 `~/.codex/config.toml`）
- 桌面端 vs web 并发 lock（codex 是否提供 lockfile API 待查）
- e2e Playwright 自动化（与 claude_code 一起做）
- 前端打字机效果（需要 codex 暴露 `item.updated` 增量事件，目前主要是终态 `item.completed`）
- session_index.jsonl 写入支持（v0.1 红线，等到能确认 codex 内部锁机制再开）
- Gemini / Cursor 同构接入（本方案已为它们铺路）

## 推荐开发顺序与里程碑

```
Week 1:  T1 backend-skeleton           [4 子模块 + 共享]
                ↓
Week 2:  T2 history-resume + T3 frontend (并行启动)
                ↓                              ↓
Week 3:           合并 + 联调                T4 unit-tests
                ↓
Week 4:  v0.1 完结，公开 demo + 反馈
```

**第一个里程碑（T1 完成）** 是最关键的——它决定整个方案的可行性。T1 完成后，团队对 codex 子进程行为、jsonl schema 真相、abort 时序等有第一手信息，T2/T3 风险显著下降。

## 进入 x-req 的检查清单

每个 task 进 x-req 前，确认：

- [ ] 范围（包含 / 不包含）和本 task-map 一致
- [ ] 依赖链清晰（T1→T2、T1→T3、T1+T2→T4）
- [ ] 关键风险点（schema 演进、stdin 阻塞、桌面端冲突）已写入 task README
- [ ] 完成标志可验证（手动验收 + 自动化）
- [ ] 引用回 spec 文档（`docs/codex-web-integration-v0.1/`）做单一真源
