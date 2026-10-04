# Task 映射

## 总体结论

这套测试集适合拆成四个 task。拆分原则是先统一语言，再统一执行，再统一报告，最后补真实链路。

## task 列表

| 模块 | 建议 task 名 | 前置依赖 | 是否可进入 x-req | 说明 |
|---|---|---|---|---|
| 测试契约 | `agent-eval-suite-schema` | 无 | 是 | 定义 case / record / grader / report |
| 确定性执行 | `agent-eval-suite-deterministic-harness` | 测试契约 | 是 | 跑 `stub` 与 `replay` lane |
| 报告与收编 | `agent-eval-suite-reporting` | 测试契约, 确定性执行 | 是 | 把现有测试映射到 case id |
| 真实链路冒烟 | `agent-eval-suite-smoke` | 前三项 | 是 | 小规模 `real-provider-smoke` |

## 推荐开发顺序

1. `agent-eval-suite-schema`
2. `agent-eval-suite-deterministic-harness`
3. `agent-eval-suite-reporting`
4. `agent-eval-suite-smoke`

## 每个 task 的验收口径

### 1. `agent-eval-suite-schema`

- `CaseSpec` 等核心结构定稿
- fixture 文件格式定稿
- 至少 6 个样例 case 能通过 schema 校验

### 2. `agent-eval-suite-deterministic-harness`

- `stub` lane 跑通
- `replay` lane 跑通
- 至少覆盖 `core + safety + context` 三个能力面

### 3. `agent-eval-suite-reporting`

- 现有测试能映射到稳定 case id
- 能输出 suite 汇总
- 每条失败能给出 trace / artifact 证据路径

### 4. `agent-eval-suite-smoke`

- 少量真实 provider 冒烟跑通
- streaming / approval / evolution 至少各保留一条真链路 case
- smoke 清单可供发布前或 nightly 使用
