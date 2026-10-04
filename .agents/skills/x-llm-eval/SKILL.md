---
name: x-llm-eval
description: 运行并分析 Kongming LLM 能力评测。用于用户要求评测大模型、用 MiniMax/GLM/其他 preset 跑 harness eval、比较模型能力、检查 benchmark 报告、验证 Kongming Agent session/tool-call 轨迹，或为 Agent Harness 面试准备中文评测报告。
---

# x-llm-eval

使用本 skill 运行基于 Kongming Agent 的 LLM benchmark，并产出由执行者撰写的评价报告。被测 LLM 可以答题、调用工具、生成最终回答；最终能力判断必须由执行者根据产物完成。

## 默认流程

1. 确认当前目录是项目根目录：

```bash
pwd
```

期望目录：

```text
/Volumes/machub_app/proj/kongming-agent
```

2. 通过 Kongming Agent runtime 跑完整 P0 题集：

```bash
uv run python scripts/run_kongming_harness_eval.py \
  --preset <preset-id> \
  --run-id <preset-id>-kongming-p0-001
```

默认 suite 是 `evals/harness-v0.1`。这个入口使用真实 `SessionEngine` / `Runner`、文件 session 持久化、`AutoAllowApproval` 和配置里的 provider preset。

3. 看到脚本打印 `run_dir` 时，把非零 exit 当成有效评测结果处理。分数低于 `1.00` 时脚本会 exit `1`，含义是有题目未通过。

4. 检查运行产物：

```bash
RUN_DIR=evals/harness-v0.1/runs/<run-id>
sed -n '1,260p' "$RUN_DIR/report.md"
python3 - <<'PY'
import json
from pathlib import Path
root = Path("evals/harness-v0.1/runs/<run-id>")
tasks = json.loads((root / "tasks.json").read_text())["tasks"]
for item in tasks:
    if not item["passed"]:
        print(item["id"], item["category"], item["score"], item["details"])
PY
```

5. 校验 session 记录：

```bash
python3 - <<'PY'
import json
from pathlib import Path
root = Path("evals/harness-v0.1/runs/<run-id>")
for session_dir in sorted((root / "sessions").glob("*")):
    jsonl = session_dir / f"{session_dir.name}.jsonl"
    assert (session_dir / "manifest.json").is_file(), session_dir
    assert (session_dir / "system_prompt.json").is_file(), session_dir
    assert jsonl.is_file(), session_dir
    records = [json.loads(line) for line in jsonl.read_text().splitlines() if line.strip()]
    roles = [record["message"]["role"] for record in records]
    call_ids = []
    result_ids = []
    for record in records:
        msg = record["message"]
        for call in msg.get("tool_calls") or []:
            call_ids.append(call["call_id"])
        if msg["role"] == "tool":
            result_ids.append(msg["tool_call_id"])
    assert sorted(call_ids) == sorted(result_ids), (session_dir.name, call_ids, result_ids)
    print(session_dir.name, "记录数=", len(records), "角色序列=", roles, "工具配对数=", len(result_ids))
print("session 校验通过")
PY
```

普通非工具题的 session 通常是 `user -> assistant`。真实工具题里，每个 assistant `tool_call` 都必须有同 `tool_call_id` 的 `role="tool"` 结果。

## 题集选择

默认使用完整 P0 题集：

```bash
uv run python scripts/run_kongming_harness_eval.py --preset minimax-m3 --run-id minimax-m3-kongming-p0-001
```

用户明确要求真实多轮工具执行闭环时，使用 runtime 工具执行专项题集：

```bash
uv run python scripts/run_kongming_harness_eval.py \
  --suite evals/harness-runtime-v0.1 \
  --preset minimax-m3 \
  --run-id minimax-m3-runtime-001
```

验证 harness 自身时使用 fixture 模式：

```bash
uv run python scripts/run_kongming_harness_eval.py \
  --suite evals/harness-v0.1 \
  --mode fixture \
  --run-id fixture-kongming-p0-001
```

只有用户明确要求模型直连基线时，才使用直连脚本。这个入口绕过 Kongming Agent runtime：

```bash
uv run python scripts/run_harness_eval.py \
  --suite evals/harness-v0.1 \
  --preset minimax-m3 \
  --run-id minimax-m3-direct-p0-001
```

## Preset 与密钥

runtime eval 使用 `config/setting.yaml` 中 `web.llm_presets` 里的 preset。

查看可用 preset：

```bash
python3 - <<'PY'
from infrastructure.config import load_config
cfg = load_config("config/setting.yaml")
for preset in cfg.web.llm_presets:
    print(preset.id, preset.model, preset.base_url, preset.api_key_env)
PY
```

报告里禁止打印 API key。用户在对话里提供临时 key 时，只能把它作为本次命令的环境变量注入；跑完后建议轮换 key。

## 评价规则

评价必须由执行者基于产物完成：

- `report.md`：脚本生成的得分概要。
- `tasks.json`：机器可读的单题分数和 scorer 细节。
- `tasks/<task_id>/trajectory.json`：题目 prompt、最终回答、事件轨迹和评分细节。
- `sessions/<session_id>/<session_id>.jsonl`：真实持久化对话。

禁止要求被测 LLM 评价自己的表现。被测 LLM 的职责是完成题目；评价者的职责是根据 benchmark 产物判断能力。

写报告时要分清：

- 模型能力失败：答案错误、工具调用缺失、参数错误、推理差。
- harness/runtime 失败：session 缺失、tool_result 未配对、provider 报错、审批阻断。
- benchmark 设计限制：样本少、精确匹配脆弱、fake tools 覆盖不足、缺少恢复类任务。

## 报告模板

使用 `assets/report-template.md` 作为报告结构。可以把模板章节复制进最终回复，也可以写成项目内报告文件，然后用 run artifacts 填充。

必需证据：

- 完整执行命令
- run 目录
- 总分
- 失败任务 ID 和原因
- session 校验结果
- 有工具任务时，至少提供一条具体 tool-call/session 观察

报告结尾给出一个具体下一步，例如跑另一个 preset、给弱项能力面补题，或把 `tool_plan` 任务升级为 `tool_execution` 任务。
