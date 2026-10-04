# Task Map

把本方案的 6 个模块映射成 `dev-pipeline/tasks/` 下的开发任务。**每一行都是一个未来的 task 目录。**

| 模块 | 建议 task 名 | 优先级 | 是否创建 task | 前置依赖 | 当前状态 | 建议流程 |
|---|---|---|---|---|---|---|
| A · provider_metadata 接入 | `llm-provider-metadata` | **P0** | **立即** | 无 | 方案确认 | `x-req` → `x-plan` → `x-dev` |
| B · reasoning 等级控制 | `reasoning-effort-control` | P1 | 是（A 完成后） | A（需要指标验证） | 方案确认 | `x-qdev` 轻量路径即可 |
| C · tools schema 压缩 | `tools-schema-compaction` | P1 | 是（A 完成后） | A（量化节省） | 方案确认 | `x-qdev` |
| D · httpx client 复用 | `httpx-client-reuse` | P1 | 是（可与 B/C 并行） | 无（A 非强依赖，但能验证） | 方案确认 | `x-qdev` |
| E · tools 动态筛选 | `tools-dynamic-selection` | P2 | 否（暂停） | C + 2 周实际数据 | 探索中 | 先继续方案讨论 |
| F · 流式响应 + TTFT | `llm-streaming` | P3 | 否（暂停） | A-E 全部落地 | 探索中 | 未来 `x-spec` 独立立项，Protocol 改动需谨慎 |

## 推进建议（用户指定路径：A → B → F）

**2026-04-22 用户决定：优先 A、B、F 三个；C/D/E 延后或按需补。**

### 第 1 步：A（P0）

- **task**：`llm-provider-metadata`
- 流程：`x-req` → `x-plan` → `x-dev`（涉及 Protocol 扩展，走完整流程）
- 关键澄清点：`provider_metadata` 强类型还是 dict？event payload 是否全量透传 `reasoning_content`？
- 交付后：`.kongming/trace.jsonl` 能直接读到 `reasoning_tokens` / `cached_tokens` / `reasoning_content`（截断版）

### 第 2 步：B（P1）

- **task**：`reasoning-effort-control`
- 流程：`x-qdev`（轻量，预期 3-5 文件改动：models + openai_responses + tests）
- 交付后：ModelConfig 加 `reasoning_effort` 配置，简单对话可关 deep thinking 省 10x reasoning tokens

### 插入建议：D（强烈建议在 F 之前做）

- **task**：`httpx-client-reuse`
- 原因：F 的核心卖点是 TTFT（首字延迟），但 TLS 握手占 TTFT 的一半。不先做 D 就做 F，实测 TTFT 数据会被握手污染，无法判断流式实现是否到位
- 流程：`x-qdev`（5-7 文件）
- 如果 **用户坚持不做 D**：F 里的 TTFT 指标要在报告中标注"含握手时延"，避免团队 / 自己误判

### 第 3 步：F（P3，必须先独立 x-spec）

- **task**：`llm-streaming`
- 流程：**先跑一次独立的 `x-spec`** 把以下展开到模块级方案：
  - `LLMProvider` Protocol 是否加 `stream_complete()` 方法（不动 `complete()`）
  - 流式下 tool_call delta 如何累加（OpenAI 规范：按 index 累加 arguments 字符串）
  - approval 链路和流式的交互：流完整个 assistant message（含 tool_calls）再走 approval，**不做**"流中暂停续流"
  - Host / CLI adapter 新增 `write_output_chunk(text)` 接口，session 不存 chunk（只存完整消息）
  - 新增 events：`llm.chunk.first` / `llm.stream.end`（不 emit 每个 chunk，避免 trace 爆炸）
  - 测试基础设施：`StubLLMStreamProvider`、契约 test 验证 stream/non-stream 结果等价
- 然后 `x-req` → `x-plan` → `x-dev`
- 预期：架构改动最大的任务（5-8 个文件 + 多层链路修改），**单独做、单独 ship**

### 延后（暂不立项）

- **C**：`tools-schema-compaction` — B 如果把 reasoning tokens 压下来，prompt 侧的优化优先级自然下降；用户可根据 A 数据决定是否补
- **E**：`tools-dynamic-selection` — 在 C 完成前无意义


## 依赖图示意

```
        A (P0)
       / | \
      /  |  \
     B   C   D    （P1，任意顺序/并行）
         |
         E        （P2，C 的下游）

     F (P3，独立大型任务，等全部落地后独立立项)
```

## 进入 x-req 的准入条件

每个 task 在进 x-req 前应至少明确：

- 当前模块在本方案里的位置（README 的模块导航表第几行）
- 相关联的 dump 数据样本路径（基线）
- 验收标准（README 最后一段"验证 & 度量"）

## 不推荐一次做完的理由

1. **回归定位成本**：一次 ship 6 个模块，如果某次真实对话挂了，要从 6 个改动里二分定位 —— 成本远高于逐个 ship
2. **数据驱动决策**：A 完成后的真实数据会反过来修正 B/C/E 的优先级（可能发现 reasoning_tokens 其实不是大头）
3. **心智负担**：本方案已经是 6 个独立改动的集合，进 code review 时 diff 规模应该控制在 200 行内 —— 单 task 天然满足
