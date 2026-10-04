# LLM Harness 评测报告

## 运行信息

- 模型 / preset：
- 题集 suite：
- 运行 ID：
- 运行目录：
- 执行命令：
- 执行时间：
- 执行者：

## 总体结果

| 指标 | 结果 |
|---|---:|
| 通过数 |  |
| 总题数 |  |
| 总分 |  |
| 有效性 | 有效 / 无效 |

有效性判断：

- 有效：模型请求成功，评分器正常执行，session 和 trajectory 可审计。
- 无效：鉴权失败、provider 请求失败、runner 崩溃、session 缺失、评分器异常。

## 分类得分

| 能力面 | 通过数 | 分数 | 判断 |
|---|---:|---:|---|
| coding |  |  |  |
| instruction_following |  |  |  |
| long_context |  |  |  |
| repo_fix |  |  |  |
| short_answer |  |  |  |
| tool_use |  |  |  |
| tool_execution |  |  |  |

## 失败任务

| 任务 ID | 能力面 | 失败原因 | 证据 |
|---|---|---|---|
|  |  |  |  |

填写要求：

- 写实际输出和期望之间的差异。
- 工具相关任务写缺失调用、错误参数、工具结果失败或最终答案未利用结果。
- provider / 鉴权 / 超时错误标记为运行失败，不计入模型能力结论。

## Session 校验

- session 文件是否存在：
- `manifest.json` 是否存在：
- `system_prompt.json` 是否存在：
- JSONL 对话是否可解析：
- tool_call / tool_result 是否配对：

逐任务校验摘要：

| 任务 ID | 记录数 | 角色序列 | 工具配对数 | 结论 |
|---|---:|---|---:|---|
|  |  |  |  |  |

## 能力判断

由执行者根据 artifacts 判断，禁止让被测 LLM 自评。

- 稳定能力：
- 暴露短板：
- 偶发风险：
- 与上一次 run 的差异：

## Harness 判断

- Kongming runtime 是否真实参与：
- 审批是否自动通过且无等待：
- session 是否隔离：
- fake tools 是否足够覆盖任务目标：
- 当前 benchmark 的局限：

## 建议动作

1. 
2. 
3. 
