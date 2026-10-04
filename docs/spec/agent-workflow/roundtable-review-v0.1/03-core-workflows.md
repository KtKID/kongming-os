# 核心流程和提示词契约

## 主流程

```mermaid
sequenceDiagram
  participant U as User
  participant P as 主 Agent
  participant T as run_agent_workflow
  participant S as RoundtableReviewStrategy
  participant B as ReviewBoard
  participant R as Reviewer Agents
  participant A as Arbiter Agent

  U->>P: /review src/sessions --topic "Session 模块设计是否合理"
  P->>T: mode=roundtable_review, payload
  T->>S: run(context, payload)
  S->>B: write context.md + sources.md
  S->>R: 并行独立评审
  R-->>S: findings JSON
  S->>B: append claims.jsonl
  loop rebuttal rounds
    S->>R: 读取 ReviewBoard 快照，做 support/refute/supplement
    R-->>S: comments JSON
    S->>B: append rebuttals.jsonl
  end
  S->>B: write consensus.md
  S->>A: 读取 ReviewBoard，输出 final report
  A-->>S: Markdown report
  S->>B: write final_report.md
  S-->>T: AgentWorkflowResult
  T-->>P: workflow_dir + report paths
```

## 触发工作流的主 Agent 提示词

主 agent 在识别到“代码模块设计 review / 多视角评审 / 圆桌评审 / `/review`”时，应先调用策略目录或直接构造 payload。

推荐主 agent 提示词：

```text
你要发起 Multi-Agent Roundtable Review。
目标是评审一个代码模块或设计文档，输出共识、分歧、高风险、修改建议、人工确认项和开发任务清单。

执行规则：
1. 使用 run_agent_workflow，mode 固定为 "roundtable_review"。
2. payload.topic 写本次评审问题。
3. payload.input_source.paths 写用户给出的模块路径或文档路径。
4. 用户指定轮次或预算时写入 payload.limits。
5. 用户未指定预算时使用 total_child_token_budget=50000。
6. 用户未指定轮次时由策略按输入规模决定 discussion_rounds，硬上限 max_discussion_rounds=6。
7. workflow 完成后读取 roundtable_review.review_board.final_report_path，并把最终报告摘要返回给用户。

禁止行为：
1. 直接用单 agent 自查替代 roundtable_review。
2. 编造 ReviewBoard 路径、claim_id、证据或子 agent 输出。
3. 在 workflow 失败时声称评审完成。
```

后续 `/review` slash command 展开文本：

```text
请使用 run_agent_workflow 发起 roundtable_review。
module_path: <用户传入路径>
topic: <用户 --topic 或剩余文本>
如果用户未给 topic，topic 使用“评审 <module_path> 的模块设计是否合理”。
```

## 独立评审子 Agent Prompt

```text
你是 {reviewer.title}（{reviewer.agent_id}）。
关注点：{reviewer.focus}
职责：{reviewer.instructions}

评审主题：
{topic}

评审目标：
{objective}

可读取材料：
- input/source/ 下的源码或文档副本
- input/input_manifest.json
- input/review_board_snapshot.md

任务：
独立审查材料，暂时只输出你的发现。
每条 finding 必须包含具体证据，证据优先使用文件路径和行号。

只输出 JSON 对象：
{
  "agent": "{reviewer.agent_id}",
  "findings": [
    {
      "severity": "P1",
      "claim": "模块边界混合了调度逻辑和持久化逻辑",
      "evidence": [{"type": "code", "path": "input/source/src/example.py", "lines": "10-30"}],
      "risk": "后续扩展会放大耦合",
      "suggestion": "拆出清晰的门户和内部实现",
      "confidence": 0.8
    }
  ]
}
```

## 交叉质询子 Agent Prompt

```text
你是 {reviewer.title}（{reviewer.agent_id}）。
本轮是第 {round_index} 轮，独立分析计为第 1 轮。

读取 input/review_board_snapshot.md 中的 claims 和已有 rebuttals。
只允许三类发言：
- support：同意某个 claim，并补充额外证据。
- refute：反对某个 claim，并说明它忽略的约束或证据。
- supplement：承认 claim 成立，并调整范围、等级或建议。

只输出 JSON 对象：
{
  "agent": "{reviewer.agent_id}",
  "comments": [
    {
      "type": "support",
      "target_claim_id": "C-001",
      "comment": "同意该 claim，另有证据显示同一问题影响测试入口",
      "evidence": [{"type": "code", "path": "input/source/tests/test_example.py", "lines": "15-40"}],
      "severity_adjustment": null,
      "confidence": 0.75
    }
  ]
}
```

## Arbiter Prompt

```text
你是 Multi-Agent Roundtable Review 的 Arbiter Agent。
你负责读取 ReviewBoard，区分共识、分歧、风险和可执行修改建议。

读取 input/review_board_snapshot.md、input/source/ 和 input/input_manifest.json。
输出 Markdown 报告，必须包含以下 6 节：
1. 共识问题
2. 主要分歧
3. 高优先级风险
4. 建议修改方案
5. 需要人工确认的问题
6. 可直接交给开发 Agent 的任务清单

每个结论都绑定 claim_id 或 evidence。证据不足的项进入“需要人工确认的问题”。
```

## 轮次语义

| 字段 | 含义 | 默认 |
------|------|------|
| `discussion_rounds` | 总轮次，包含独立评审 | 策略按输入规模取 2-4 |
| 第 1 轮 | 独立评审 | 必有 |
| 第 2..N 轮 | 交叉质询 | 可选 |
| `max_discussion_rounds` | 硬上限 | 6 |

## 失败处理

| 失败点 | 行为 |
--------|------|
| 输入文件为空 | workflow 参数失败，产物只记录通用 tool 失败 |
| 单个 reviewer 超时 | 写 agent_failed，继续其他 reviewer |
| reviewer 输出非法 JSON | 写 validation error，跳过非法记录 |
| 预算耗尽 | 停止后续 rebuttal 或 arbiter，写 fallback final_report |
| arbiter 失败 | 使用 deterministic fallback 生成 final_report |
