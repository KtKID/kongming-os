# 核心工作流

## 工作流一览

| # | 工作流 | 触发 | 文档段 |
|---|---|---|---|
| 1 | **Claude 通道查询** | 前端打开 thread / WS 帧刷新 | [§1](#1-claude-通道查询流程) |
| 2 | **Codex 通道查询** | 同上 | [§2](#2-codex-通道查询流程) |
| 3 | **Generic Chat 通道查询** | 同上 | [§3](#3-generic-chat-通道查询流程) |
| 4 | **WS 帧 emit** | service.py 收到 SDK 消息 | [§4](#4-ws-帧-emit-流程) |
| 5 | **REST hydrate** | 前端首次打开 thread | [§5](#5-rest-hydrate-流程) |
| 6 | **schema v8→v9 lazy upgrade** | metadata.json 首次读 | [§6](#6-schema-v8v9-lazy-upgrade) |
| 7 | **v1→v2 渐进迁移** | 装配层切换 | [§7](#7-v1v2-渐进迁移流程) |

## 1. Claude 通道查询流程

```
前端 (tab A, thread-X claude_code 通道)
   │
   ▼
GET /threads/<X>/usage      (或 WS usage_summary_updated 帧)
   │
   ▼
router/ws_event_sink → manager.get_thread_usage("thread-X")
   │
   ├─ ① meta_reader.read("thread-X")
   │       └─ asyncio.to_thread(read_thread_metadata, home, "thread-X")
   │       └─ 返回 {backend_kind: "claude_code", cwd, claude_thread_id, ...}
   │
   ├─ ② match backend_kind:
   │       case "claude_code":
   │           path = await claude_locator.locate("thread-X")
   │           # 内部：jsonl_path_for(meta.cwd, meta.claude_thread_id)
   │           # → ~/.claude/projects/<encode(cwd)>/<claude_thread_id>.jsonl
   │
   ├─ ③ if path is None or not path.is_file():
   │       return None
   │
   └─ ④ await asyncio.to_thread(_derive_claude.derive_from_jsonl, path)
           │
           ├─ 流式按行读 jsonl
           ├─ 过滤 type=="assistant" + 含 message.usage 的行
           ├─ 持续更新 last_usage / last_model（覆盖式，取最后一条）
           └─ _map_to_claude_usage(last_usage, last_model) → ClaudeUsage
                   │
                   ├─ 1:1 映射 SDK 字段
                   ├─ context_usage = input + cache_read + cache_creation 派生
                   └─ context_window = 内置表查 model
   │
   ▼
ClaudeUsage{provider:"claude", input_tokens:6, cache_read_input_tokens:341086, ...}
   │
   ▼
前端按 usage.provider === "claude" 渲染 <StatusLineClaude />
```

**性能**：1500 行 jsonl 文件 1-2ms，O(N) 流式读。

## 2. Codex 通道查询流程

```
前端 (tab B, thread-Y codex 通道)
   │
   ▼
manager.get_thread_usage("thread-Y")
   │
   ├─ ① meta_reader.read → {backend_kind: "codex", codex_thread_id, ...}
   │
   ├─ ② codex_locator.locate("thread-Y")
   │       └─ 内部扫 ~/.codex/sessions/YYYY/MM/DD/rollout-*-<codex_thread_id>.jsonl
   │       └─ 返回 Path 或 None
   │
   └─ ③ await asyncio.to_thread(_derive_codex.derive_from_rollout, path)
           │
           ├─ 流式按行读
           ├─ 过滤 type=="event_msg" + payload.type=="token_count" + payload.info != None
           ├─ 持续更新 last_token_event（取最后一条）
           └─ _map_to_codex_usage(last_token_event) → CodexUsage
                   │
                   └─ 1:1 映射 info.total_token_usage / info.last_token_usage
                      / info.model_context_window / rate_limits
   │
   ▼
CodexUsage{provider:"openai", total:{...}, last:{...}, model_context_window:258400, ...}
   │
   ▼
前端按 usage.provider === "openai" 渲染 <StatusLineCodex />
```

**关键差异 vs Claude**：

- codex_locator **要扫目录**（路径里有年/月/日时间戳，不能直接拼）
- codex **自带累加**（`info.total_token_usage`），派生器不算
- codex **自带 context_window**，不查模型表
- codex **自带 rate_limits**（Claude 没有）

## 3. Generic Chat 通道查询流程

```
前端 (tab C, thread-Z generic_chat 通道，preset_id=anthropic-xxx)
   │
   ▼
manager.get_thread_usage("thread-Z")
   │
   ├─ ① meta_reader.read → {backend_kind: "generic_chat", preset_id: "anthropic-xxx", ...}
   │
   ├─ ② generic_locator.locate("thread-Z")
   │       └─ 内部查 session backend 配置（memory / sqlite / file）
   │       └─ 返回当前 thread 的 session 数据路径 / sqlite 连接器
   │
   └─ ③ await asyncio.to_thread(
           _derive_generic.derive_from_session,
           path,
           preset_id,
       )
           │
           ├─ 按 preset_id 查 LLMProvider 厂商
           │   - "anthropic-*" → 走 ClaudeUsage 映射逻辑
           │   - "openai-*" / "moonshot-*" / etc → 走 OpenAI 映射逻辑
           │
           ├─ 扫 session message 流，找最后一条带 LLMResponse.usage 的 message
           │
           └─ 按厂商映射：
                   ├─ Anthropic 系 → GenericChatAnthropicUsage（同 ClaudeUsage 字段）
                   └─ OpenAI 系 → GenericChatOpenAIUsage（同 CodexTokenBreakdown 字段，但要自己累加）
   │
   ▼
GenericChat{Anthropic|OpenAI}Usage
   │
   ▼
前端按 provider 字段渲染（复用 StatusLineClaude / 用 StatusLineGenericChatOpenAI）
```

**待定**（task 实施前敲定）：

- session backend 数据具体格式（memory dict / sqlite row schema / file jsonl）
- preset_id → 厂商映射表来源（config_loader 还是 manager 内置）
- OpenAI 系 generic_chat 怎么累加（每轮的 LLMResponse 都加，还是只取最后一轮？）

## 4. WS 帧 emit 流程

```
SDK 主循环 (claude_code/service.py::_consume)
   │
   ▼ 收到 AssistantMessage / ResultMessage(complete)
   │
service.py 决定要 emit 一次 usage 更新（不再 push token 给 manager）
   │
   ├─ ① usage = await manager.get_thread_usage(thread_id)
   │       └─ manager 内部走 §1 流程 → 返回 ClaudeUsage 或 None
   │
   ├─ ② if usage is None: skip
   │
   └─ ③ frame = {
           "kind": "usage",
           "turn": run_index,
           "run_id": f"{thread_id}-{run_index}",
           "usage": usage.model_dump(),
       }
           │
           └─ await broadcaster.broadcast(frame) → 前端 WS
```

**关键差异 vs v1**：

- v1：emit 前先 `record_run_usage` 写盘（竞争源）
- v2：**只查询**（manager 从 SDK jsonl 派生）+ emit；service.py 零写盘

**通用化**：codex_service / ws_event_sink 走完全相同的模板，把 `claude_code` 字面替换成对应通道即可。

## 5. REST hydrate 流程

```
前端打开 thread 页面（首次加载）
   │
   ▼
GET /threads/<tid>            (返回 thread 配置，不含 token)
GET /threads/<tid>/usage      (单独端点拿 token DTO)
GET /threads/<tid>/messages   (历史消息)
   │
   ├─ /threads/<tid>：       router._to_dto(thread_meta) → 返回 ThreadMetadataDTO
   │                          （v9 schema，**不**含 cumulative_usage / last_run_snapshot
   │                          / last_model_name）
   │
   ├─ /threads/<tid>/usage：  新端点：调 manager.get_thread_usage(tid) → ClaudeUsage |
   │                          CodexUsage | GenericChatUsage | None
   │
   └─ /threads/<tid>/messages：保留现状（不动）
   │
   ▼
前端
   ├─ 配置数据 hydrate threadStore
   ├─ usage 数据按 provider 分支渲染 StatusLine
   └─ 历史消息 hydrate chatStore
```

**为什么 usage 单独一个端点**：

- usage 数据可独立刷新（前端切 thread / WS push 触发部分刷新）
- 跟 thread 配置解耦（thread name / cwd 改了不会污染 usage 缓存）
- 后端单一职责：router/threads.py 不再 await manager.get_thread_summary

## 6. schema v8→v9 lazy upgrade

```
read_thread_metadata(home, tid)
   │
   ▼
read raw json
   │
   ▼ json.loads
   │
   ├─ v1→v2 懒升级（旧）
   ├─ v2→v3 懒升级（旧）
   ├─ ... 各历史版本懒升级链
   ├─ v7→v8 懒升级（v0.1 引入）
   │
   └─ v8→v9 懒升级（v2 新增）：
       if data.get("schema_version") == 8:
           data.pop("cumulative_usage", None)
           data.pop("last_run_snapshot", None)
           data.pop("last_model_name", None)
           data["schema_version"] = 9
   │
   ▼
ThreadMetadata.model_validate(data)  ← v9 schema 接受
```

**幂等**：v9 dict 再过 upgrade 不变化（条件 `== 8` 不命中）。

**不写回**：lazy upgrade 不主动写盘；下次 thread CRUD 操作触发写盘时自然落 v9 schema（永远写 v9）。

**测试覆盖**：

- v7 文件读入 → v8 → v9（穿透多层升级）
- v8 文件读入 → v9（带 3 token 字段被 drop）
- v9 文件读入 → v9（幂等）
- 损坏文件 → None
- v10+ 文件（未来版本）→ None（拒绝未知）

## 7. v1→v2 渐进迁移流程

**两个包并存阶段**（task 1-5 期间）：

```
src/web/usage_token/        ← v1（保留，加 DeprecationWarning）
├── manager.py              ← 公共 API（record_run_usage 等）保留但弃用
├── _derive_claude_code.py  ← v0.1 派生器，**实际逻辑迁到 v2 后退役**
└── ...

src/web/usage/usage_token_v2/     ← v2 新建
├── manager.py
├── _models.py
├── _derive_claude.py       ← 重命名 + 加 cache_creation 细分等
├── _derive_codex.py        ← 新建
├── _derive_generic.py      ← 新建
└── _model_context_table.py ← 从 v1 迁来
```

**迁移触发点**（按 task 推进）：

| Task | 切换内容 | 状态 |
|---|---|---|
| Task 1 | metadata.json schema v9 + lazy upgrade | v1 兼容 |
| Task 2 | 新建 v2 包 + 三派生器 + DTO | v1 v2 并存 |
| Task 3 | claude_code/service.py 切到 v2 | claude 通道走 v2，codex/generic_chat 仍 v1 |
| Task 4 | codex/service.py + ws_event_sink 切到 v2 | 三通道全 v2 |
| Task 5 | 前端 StatusLine 拆分 + protocol.ts 切 v2 DTO | UI 切换 |
| Task 6 | 删除 v1 包 + UsagePersistSink + ThreadMetadataIOAdapter | 收尾 |

**迁移期 v1 API 行为**：

- `manager.record_run_usage` / `set_last_assistant_usage` 加 `DeprecationWarning`
- 但仍**保留写盘行为**（避免迁移期间 v1 调用方退化）—— task 4 之后再删
- v1 的 `get_thread_summary` 内部已经走派生（v0.1 改动），可以继续工作

**回退路径**：

如果 v2 任一 task 出问题，可以**单独回滚那个 task** 的 commit，不影响其他 task。每个 task 独立 commit 是这个 spec 的关键安全设计。

## 数据流总览图

```
┌──────────────────────────────────────────────────────────────────────┐
│                        外部世界                                       │
│                                                                        │
│  SDK 自己写：                                                          │
│   ~/.claude/projects/<X>/<tid>.jsonl    (Claude SDK 写)                │
│   ~/.codex/sessions/<Y>/rollout-*.jsonl (Codex CLI 写)                 │
│                                                                        │
│  我们自己写：                                                          │
│   .kongming/web/sessions/<sid>/        (我们的 session backend)        │
│   .kongming/web/threads/<tid>/metadata.json (v9，无 token 字段)        │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘
                        │                              ▲
              派生器只读，零写              ThreadCRUD 只写非 token 字段
                        │                              │
        ┌───────────────┴──────────────┐               │
        ▼                              ▼               │
┌─────────────────────────────────────────────────────┴───────────────┐
│                  src/web/usage/usage_token_v2/                              │
│                                                                        │
│      UsageTokenManager (无状态门面)                                    │
│        ├─ __init__(meta_reader, claude_locator, codex_locator, ...)    │
│        └─ async get_thread_usage(tid) → ThreadUsage | None             │
│                                                                        │
│      私有派生器（包内消费）                                            │
│        ├─ _derive_claude.derive_from_jsonl                             │
│        ├─ _derive_codex.derive_from_rollout                            │
│        └─ _derive_generic.derive_from_session                          │
│                                                                        │
│      公共 DTO（外部可见）                                              │
│        ├─ ClaudeUsage (provider="claude")                              │
│        ├─ CodexUsage (provider="openai")                               │
│        ├─ GenericChatAnthropicUsage (provider="claude")                │
│        └─ GenericChatOpenAIUsage (provider="openai")                   │
└─────────────────────────────────────────────────────────────────────┘
                        │
        ┌───────────────┴──────────────────┐
        ▼                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    外部消费方                                        │
│                                                                       │
│   GET /threads/<tid>/usage   (router/usage.py 新增)                  │
│   WS frame {kind:"usage", usage: DTO}  (ws_event_sink 包装)          │
│   service.py emit usage_summary_updated  (claude_code/codex)         │
│                                                                       │
│   前端 StatusLine 按 usage.provider 分支：                            │
│     ├─ StatusLineClaude  (provider==="claude")                       │
│     ├─ StatusLineCodex   (provider==="openai" + has rate_limits)     │
│     └─ StatusLineGenericChat                                          │
└─────────────────────────────────────────────────────────────────────┘
```
