司天报告建议采用 **JSON 作为主结构，Markdown / UI 卡片作为渲染层**。核心数据结构分 5 块：`report_meta`、`global_summary`、`alerts`、`task_snapshots`、`actions`。

## 1. 顶层报告结构

```json
{
  "report_id": "sitian_report_20260515_140000",
  "generated_at": "2026-05-15T14:00:00+08:00",
  "scope": {
    "workspace_id": "xspace",
    "project_ids": ["kongming-agent", "x-dev-pipeline"],
    "task_count": 12,
    "session_count": 8
  },
  "global_summary": {},
  "alerts": [],
  "task_snapshots": [],
  "actions": [],
  "llm_analysis": {},
  "ui_hints": {}
}
```

顶层只放报告元信息和索引，具体风险放到 `alerts`，具体任务状态放到 `task_snapshots`。

## 2. global_summary：全局态势

```json
{
  "health_score": 72,
  "severity": "medium",
  "summary_text": "当前有 3 个任务存在流程风险，其中 1 个高优先级任务需要处理。",
  "pipeline_distribution": {
    "spec": 2,
    "req": 1,
    "dev": 4,
    "verify": 2,
    "qa_gate": 1,
    "fix": 1,
    "done": 1
  },
  "risk_counts": {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3
  },
  "top_concerns": [
    "Dev 后缺 Verify",
    "任务长期停留在 Dev",
    "Spec / Req 产物缺失"
  ]
}
```

这个结构用于司天面板顶部，比如“今日风险 3，高优先级 1，流程健康度 72”。

## 3. alerts：核心提醒队列

这是最重要的数据结构，司天角色的气泡和提醒面板都从这里读取。

```json
{
  "alert_id": "alert_001",
  "type": "missing_stage_artifact",
  "severity": "high",
  "confidence": 0.91,
  "status": "open",
  "title": "Dev 已完成，但 Verify 产物缺失",
  "display_message": "这个任务已经进入 Dev 后段，但还没有 Verify 记录。我建议先补一次验证，避免直接进入 QA Gate。",
  "task_ref": {
    "task_id": "evolution-toast-llm-report",
    "task_name": "evolution-toast-llm-report",
    "project_id": "kongming-agent"
  },
  "pipeline_context": {
    "current_stage": "dev",
    "completed_stages": ["spec", "req", "dev"],
    "missing_stages": ["verify", "qa_gate"],
    "required_next_stage": "verify"
  },
  "evidence": [
    {
      "kind": "stage_artifact",
      "message": "verify.md 缺失",
      "ref": "tasks/evolution-toast-llm-report/verify.md"
    },
    {
      "kind": "session_summary",
      "message": "最近 10 条消息集中在报告展示和数据接入讨论",
      "ref": "session_20260515_001"
    }
  ],
  "rule_hits": [
    "dev_completed_but_verify_missing",
    "qa_gate_required_after_verify"
  ],
  "llm_reason": "该任务已经产生开发相关讨论和产物，但验证阶段缺少记录。当前最合理的动作是补 Verify，而不是继续推进后续阶段。",
  "suggested_actions": [
    {
      "action_id": "open_verify",
      "label": "补齐 Verify",
      "kind": "create_stage_artifact",
      "target": "verify"
    },
    {
      "action_id": "open_task",
      "label": "打开任务",
      "kind": "open_task",
      "target": "evolution-toast-llm-report"
    },
    {
      "action_id": "snooze",
      "label": "稍后提醒",
      "kind": "snooze",
      "duration_minutes": 60
    }
  ],
  "created_at": "2026-05-15T14:00:00+08:00",
  "updated_at": "2026-05-15T14:00:00+08:00",
  "dedupe_key": "evolution-toast-llm-report:dev_completed_but_verify_missing",
  "cooldown_until": "2026-05-15T15:00:00+08:00"
}
```

推荐的 `alert.type` 枚举：

```text
stage_stalled
missing_stage_artifact
skipped_stage
post_dev_no_verify
verify_no_qa_gate
qa_failed_no_fix
fix_no_reverify
inactive_task
requirement_drift
repeated_fix_loop
ambiguous_goal
```

## 4. task_snapshots：任务状态快照

这是脚本收集的结构化数据，LLM 也主要吃这个。

```json
{
  "task_id": "evolution-toast-llm-report",
  "task_name": "evolution-toast-llm-report",
  "project_id": "kongming-agent",
  "workspace_id": "xspace",
  "status": "active",
  "priority": "normal",
  "pipeline": {
    "template": "完整流水线",
    "stages": ["spec", "req", "dev", "verify", "qa_gate", "fix"],
    "current_stage": "dev",
    "stage_states": {
      "spec": {
        "status": "missing",
        "artifact_exists": false,
        "updated_at": null
      },
      "req": {
        "status": "missing",
        "artifact_exists": false,
        "updated_at": null
      },
      "dev": {
        "status": "in_progress",
        "artifact_exists": true,
        "updated_at": "2026-05-15T13:40:00+08:00",
        "time_in_stage_minutes": 48
      },
      "verify": {
        "status": "pending",
        "artifact_exists": false,
        "updated_at": null
      },
      "qa_gate": {
        "status": "pending",
        "artifact_exists": false,
        "updated_at": null
      },
      "fix": {
        "status": "not_required",
        "artifact_exists": false,
        "updated_at": null
      }
    }
  },
  "activity": {
    "last_active_at": "2026-05-15T13:58:00+08:00",
    "last_session_id": "session_20260515_001",
    "recent_session_count": 2,
    "recent_message_count": 10,
    "time_since_last_activity_minutes": 2
  },
  "recent_context": {
    "last_10_messages_summary": [
      "讨论司天报告展示方式",
      "讨论数据收集和 LLM 分析分工",
      "确认脚本负责收集，LLM 负责分析"
    ],
    "recent_file_changes": [
      {
        "path": "sitian/manager.py",
        "change_type": "modified",
        "updated_at": "2026-05-15T13:42:00+08:00"
      }
    ],
    "recent_errors": []
  },
  "risk": {
    "rule_risk_score": 68,
    "llm_risk_score": 74,
    "final_risk_score": 72,
    "risk_level": "medium",
    "rule_hits": [
      "spec_missing",
      "req_missing",
      "verify_pending"
    ]
  }
}
```

`task_snapshots` 是事实层。`alerts` 是提醒层。两者分开，前端和 LLM 都更好处理。

## 5. actions：可执行建议

每条提醒内可以带 `suggested_actions`，顶层也可以聚合一批推荐动作。

```json
[
  {
    "action_id": "action_001",
    "label": "为 evolution-toast-llm-report 补齐 Verify",
    "kind": "create_stage_artifact",
    "priority": "high",
    "task_id": "evolution-toast-llm-report",
    "target_stage": "verify",
    "requires_user_confirm": true,
    "payload": {
      "template": "verify",
      "prefill_from": ["recent_context", "dev_artifact"]
    }
  },
  {
    "action_id": "action_002",
    "label": "查看今日高风险任务",
    "kind": "open_alert_panel",
    "priority": "medium",
    "requires_user_confirm": false
  }
]
```

推荐的 `action.kind`：

```text
open_task
open_session
create_stage_artifact
advance_stage
rollback_stage
run_verify
run_qa_gate
create_fix_task
snooze
dismiss
mark_exception
```

## LLM 输出结构

LLM 分析结果建议压缩成这个：

```json
{
  "llm_analysis": {
    "overall_judgement": "当前主要风险来自流程产物缺失，而不是开发活动停滞。",
    "top_priority_alert_id": "alert_001",
    "recommended_focus": "先补齐 Verify，再进入 QA Gate。",
    "tone": "calm",
    "character_message": "我发现这个任务已经进入开发后段，但 Verify 还没有留下记录。建议先补验证，再继续推进。",
    "confidence": 0.88
  }
}
```

这里的 `character_message` 就是司天角色嘴里冒出来的话。

## UI 渲染格式

前端可以直接按这个顺序展示：

```text
司天报告
- 全局健康度：72
- 今日风险：高 1 / 中 2 / 低 3
- 当前最重要提醒：Dev 已完成，但 Verify 产物缺失

风险队列
1. [高] evolution-toast-llm-report：Dev 后缺 Verify
2. [中] xspace-ui：Dev 阶段停留过久
3. [中] voice-agent：Req 后 3 天无活跃

建议动作
- 补齐 Verify
- 打开任务
- 稍后提醒
```

第一版建议你只实现这 4 个对象：

```text
SitianReport
SitianAlert
TaskSnapshot
SuggestedAction
```

核心字段优先级：

```text
必须有：
report_id
generated_at
global_summary
alerts[]
task_snapshots[]
suggested_actions[]

Alert 必须有：
type
severity
title
display_message
task_ref
evidence
rule_hits
suggested_actions
dedupe_key
cooldown_until
```

最终建议：**第一版用 `task_snapshot.json` 存事实，用 `sitian_report.json` 存结论，用 `alerts.json` 驱动 UI。司天角色只读取最高优先级 alert 的 `display_message`。**
