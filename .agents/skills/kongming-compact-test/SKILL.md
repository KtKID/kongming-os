---
name: kongming-compact-test
description: |
  在 kongming-agent 上执行上下文压缩验证。用户提到“测试 compact/压缩”“主动 /compact”“三种 compact 触发”“检查 context checkpoint、FileSession、raw dump、压缩前后 token/cache”“用 GLM/MiniMax 跑真实压缩”“确认 system prompt 压缩后仍存在”时必须使用。默认走 60000 端口的真实 Web thread、FileSession、浏览器和 dump 证据；也支持三触发 pytest 与现有 session 只读审计。
compatibility: 仅用于 /Volumes/machub_app/proj/kongming-agent；需要 uv、jq、真实 Web 浏览器控制，以及所选 provider 的本地凭据。
---

# Kongming Compact Test

验证 Kongming 的 context checkpoint compaction。最终结论必须同时绑定浏览器、FileSession、trace、provider raw dump 和 usage；pytest 数量只作为补充证据。

开始前读取 [证据合同](references/evidence-contract.md)。它定义 checkpoint 字段、请求形态、token 对比和通过标准。

## 模式选择

根据用户目标选择一个主模式：

| 模式 | 使用场景 | 是否修改运行状态 |
|---|---|---|
| `manual-live` | 默认；真实模型、Web、主动 `/compact`、dump、压缩后继续对话 | 会启动或重启服务并创建 thread |
| `trigger-suite` | 验证 MANUAL、RUN_START、TOOL_RESULT 共用链路 | 只运行隔离 pytest 临时目录 |
| `artifact-audit` | 用户给出现有 thread/session，要求判断压缩是否成功 | 只读现有 session、trace、dump |
| `provider-live` | 发布门禁；运行仓库真实 MiniMax compact E2E | 调用真实 provider，写 pytest 临时目录 |

用户指定模式、模型、端口或 home 时使用用户值。`manual-live` 默认值：

- 项目根：`/Volumes/machub_app/proj/kongming-agent`
- Web：`http://127.0.0.1:60000`
- Kongming home：`/Users/kid/.kongming`
- preset：`bigmodel-glm5-1m`（GLM-5.2）
- session backend：`file`
- dump：`KONGMING_TRACE_RAW_LLM=1`

## 硬边界

- 只把 FileSession checkpoint 作为持久化成功证据。SQLite 和 memory backend 只验证“能力不可用/跳过”的既有边界。
- 保留 raw transcript。checkpoint 只改变后续 LLM 的 active context。
- 直接检查 checkpoint summary。后续模型回答用于验证 continuation，不能替代 summary 事实检查。
- 测试消息使用“这是新的事实，压缩摘要必须保留它”。避免“请记住”，避免触发长期 memory。
- 每条测试消息都要求“禁止调用工具”。出现任意 tool call 时，把本轮标记为受污染并重跑新 thread。
- dump 可能包含完整 system prompt、memory 和用户内容。只保存到本机，报告里禁止展开隐私内容和 authorization header。
- 不编辑、移动或删除 `/Users/kid/.kongming/setting.yaml`、`model-providers.yaml`。正式配置校验失败时报告阻塞；需要临时备份时先取得用户明确授权。
- 不把缓存命中本身判为失败。固定 system prompt 和 tool schemas 会继续命中 provider prefix cache。

## `manual-live` 流程

### 1. 记录测试前状态

在项目根运行：

```bash
git status --short --branch
./start.sh web status --home /Users/kid/.kongming
```

记录服务是否原本运行、PID、端口、server log 路径。记录测试开始时间和测试前最新的 `raw-llm-*.json`，后续只分析本轮新增 dump。

检查正式 home 的有效配置与仓库默认配置，确认新建 thread 实际写入 `<kongming_home>/sessions/<thread_id>/<thread_id>.jsonl`。确认目标 preset 在正式 catalog 或 `config/model-providers.yaml` 有正整数 `context_window_tokens`。凭据只判断是否存在，禁止输出值。检测到 memory/sqlite backend 时停止 `manual-live`，报告 FileSession 前置条件未满足。

### 2. 启动带 dump 的当前代码

代码刚修改时先构建并重启。服务原本停止时使用：

```bash
env -u ALL_PROXY -u HTTPS_PROXY -u HTTP_PROXY \
  -u all_proxy -u https_proxy -u http_proxy \
  KONGMING_TRACE_RAW_LLM=1 \
  ./start.sh web start --build --home /Users/kid/.kongming
```

服务原本运行且代码已变化时，先执行 `./start.sh web build`，再运行：

```bash
env -u ALL_PROXY -u HTTPS_PROXY -u HTTP_PROXY \
  -u all_proxy -u https_proxy -u http_proxy \
  KONGMING_TRACE_RAW_LLM=1 \
  ./start.sh web restart --home /Users/kid/.kongming
```

启动后运行 `curl -sf http://127.0.0.1:60000/api/health`，并确认响应来自当前 PID。

正式 home 的配置或 catalog 无法被当前 schema 加载时停止测试并报告精确错误。用户授权隔离测试时，使用临时 `KONGMING_HOME`，并在报告中标记“isolated runtime”。

### 3. 浏览器创建真实 thread

使用项目的 `browser-mcp-verify` / Browser 流程打开 `http://127.0.0.1:60000/chat`。登录密码从本地环境读取，禁止打印。

创建新对话后：

1. 在 UI 中选择目标 preset，确认模型 badge 与目标一致。
2. 记录 thread URL、thread id、workspace、reasoning 档位。
3. 截图保存到 `/private/tmp/kongming-compact-<thread_id>-before.png`。

### 4. 构造干净的压缩上下文

依次发送三轮。事实值保持精确，主题互不相同；需要观察 token 降幅时让每轮输出约 800–1200 字：

```text
本轮新增事实 ALPHA=oak-731，压缩摘要必须保留它。禁止调用任何工具。请用约800字说明上下文压缩的目标，只输出正文。
```

```text
本轮新增事实 BETA=river-482，压缩摘要必须保留它。禁止调用任何工具。请用约800字比较摘要压缩与直接截断，只输出正文。
```

```text
本轮新增事实 GAMMA=star-965，压缩摘要必须保留它。禁止调用任何工具。请用约1000字说明事实、决策和工具结果如何在摘要中延续，只输出正文。
```

每轮等待运行完成，记录 trace 中 provider-reported input、cache read、output、message count。出现 `memory`、`evolution_write` 或其他 tool call 时，新建 thread 重跑。

### 5. 主动触发压缩

在浏览器输入 `/compact` 并发送。确认 UI 显示 checkpoint 已保存或等价成功提示。

记录：

- `history.compact.started`
- `history.compact.completed`
- `trigger=manual`
- `checkpoint_id`
- `source_revision`
- model/preset/window/threshold
- summary usage

手动触发允许低于 90% 阈值。报告中同时列出 `estimated_input_tokens` 和 `threshold_tokens`，用于证明 MANUAL 与自动阈值相互独立。

### 6. 直接检查 FileSession checkpoint

目标文件：

```text
/Users/kid/.kongming/sessions/<thread_id>/<thread_id>.jsonl
```

必须确认：

- 本轮恰好新增一个 `record_type=context_checkpoint`。
- `trigger=manual`、`prompt_version`、model/preset/window/usage 完整。
- `replacement_history` 末尾是内部 checkpoint summary。
- summary 以用户日常语言为主体。
- summary 精确包含 `ALPHA=oak-731`、`BETA=river-482`、`GAMMA=star-965`；Markdown 表格形式同样有效。
- raw message 记录不含 `/compact`。
- raw transcript 仍含压缩前 user/assistant 内容。

FileSession 是事实真源。UI 成功提示与 assistant 召回只能作为旁证。

### 7. 验证压缩后 continuation

发送：

```text
禁止调用任何工具。逐行返回压缩摘要中的 ALPHA、BETA、GAMMA，格式为 KEY=value；再用一句话列出刚才三轮主题。
```

确认回答值和主题正确。截图保存到：

```text
/private/tmp/kongming-compact-<thread_id>-after.png
```

### 8. 检查请求和 dump

本轮新增 dump 位于：

```text
/Users/kid/.kongming/debug/raw-llm-*.json
```

至少识别三类请求：压缩前最后一次普通请求、summary 请求、压缩后第一次普通请求。检查：

- model 与用户选择一致。
- summary 请求 `stream=false`、`tools` 为空、HTTP status 成功。
- 普通请求保留完整 system message。
- 压缩前后 system message 逐字一致。
- 压缩后普通请求使用 checkpoint replacement；旧 assistant/tool 历史已由 summary 承载。
- header 中的 credential 保持脱敏。

### 9. 对比 token 与缓存

使用 trace 的 provider-reported usage，对比压缩前最后一次普通请求与压缩后第一次普通请求：

| 指标 | 压缩前 | 压缩后 | 变化 |
|---|---:|---:|---:|
| input_total_tokens |  |  |  |
| cache_read_tokens |  |  |  |
| message_count |  |  |  |

说明 system prompt 与工具 schema 构成固定底座。`cache_read_tokens` 保持非零代表固定前缀继续复用；关注总 input、active history 形态与 message count 的变化。两次用户问题长度不同时，把百分比标为“现场观测”，避免表述为严格 benchmark。

### 10. 恢复环境

关闭浏览器测试 tab，并执行浏览器流程要求的 tab finalize。保持 session、trace、dump 和截图作为证据。

- 服务测试前停止：运行 `./start.sh web stop --home /Users/kid/.kongming`。
- 服务测试前运行：运行 `./start.sh web restart --home /Users/kid/.kongming`，清除临时 dump env 覆盖；再次检查 health 与 PID。
- 任何得到用户授权的临时配置移动，都必须原路径恢复并验证临时备份消失。

报告最终服务状态和恢复结果。

## `trigger-suite` 流程

运行真实 Manager、Runner、FileSession 的隔离 E2E：

```bash
uv run pytest -p no:cacheprovider -q \
  tests/e2e/test_context_compaction_triggers.py::test_manual_command_persists_checkpoint_and_restart_consumes_it \
  tests/e2e/test_context_compaction_triggers.py::test_run_start_compacts_after_new_user_before_normal_sampling \
  tests/e2e/test_context_compaction_triggers.py::test_tool_result_compacts_only_after_complete_batch
```

逐条报告穿过的真实组件、fake 仅替换的外部 LLM 边界、trigger 时序和 checkpoint 结果。三条绿灯证明触发合同；它们不证明真实 provider 或浏览器链路。

## `provider-live` 流程

用户明确要求 MiniMax 发布门禁时运行：

```bash
set -a
source .env
set +a
unset ALL_PROXY HTTPS_PROXY HTTP_PROXY all_proxy https_proxy http_proxy
KONGMING_RUN_LIVE_CONTEXT_COMPACTION=1 \
  uv run pytest -p no:cacheprovider -q tests/e2e/test_context_compaction_minimax_live.py
```

该用例直接检查 checkpoint summary 的用户语言、三个新事实、prompt version、restart 和后续召回。禁止输出 API key。

## `artifact-audit` 流程

保持只读。用户提供 thread id 后检查：

1. `<home>/sessions/<thread_id>/<thread_id>.jsonl`
2. `<home>/sessions/<thread_id>/trace.jsonl`
3. checkpoint 创建时间附近的 `debug/raw-llm-*.json`

恢复 checkpoint lineage，匹配 `checkpoint_id`、`source_revision`、completed event、summary provider response id 和压缩后首次 run。证据缺失时把状态报告为“证据不足”，保持 session 原样。

## 汇报格式

```markdown
Kongming Compact E2E：通过 / 失败 / 阻塞 / 证据不足

目标：
- 模式：...
- Runtime：formal / isolated
- URL / Thread：...
- Preset / model：...

Checkpoint：
- trigger / checkpoint_id / source_revision：...
- model window / threshold / estimated input：...
- prompt version / summary usage：...
- 用户语言与新增事实：...

请求形态：
- 压缩前：...
- summary：...
- 压缩后：...
- system prompt：完整保留 / 异常

Usage：
| 指标 | 压缩前 | 压缩后 | 变化 |
|---|---:|---:|---:|

证据：
- Screenshot：...
- Session：...
- Trace：...
- Raw dumps：...

环境恢复：...
结论：...
```

结论必须明确区分：触发成功、checkpoint 持久化成功、摘要质量通过、continuation 通过、token 现场变化。最终推荐以 FileSession checkpoint 和 raw dump 作为发布门禁主证据。
