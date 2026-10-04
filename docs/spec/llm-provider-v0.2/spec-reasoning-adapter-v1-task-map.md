# Reasoning Adapter V1 Task Map

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 | 建议流程 |
|---|---|---|---|---|---|
| A. 统一语义与能力表 | `reasoning-adapter-v1-foundation` | 是 | 无 | 方案确认 | `x-req` -> `x-plan` -> `x-dev` |
| B. OpenAI-compatible 适配 | `reasoning-adapter-v1-openai` | 是 | A | 方案确认 | `x-req` -> `x-plan` -> `x-dev` |
| C. Anthropic-compatible 适配 | `reasoning-adapter-v1-anthropic` | 是 | A | 方案确认 | `x-req` -> `x-plan` -> `x-dev` |
| D. 契约测试补强 | `reasoning-adapter-v1-contract-tests` | 是 | A + B + C | 方案确认 | `x-req` -> `x-plan` -> `x-dev` |

## 推荐推进顺序

1. `reasoning-adapter-v1-foundation`
2. `reasoning-adapter-v1-openai`
3. `reasoning-adapter-v1-anthropic`
4. `reasoning-adapter-v1-contract-tests`

## 第一版范围控制

V1 只允许以下模型进入 task：

- `gemma-4-e4b-it`
- `glm*`
- `MiniMax-M2.7*`

以下内容继续留在方案层，不进入本轮 task：

- GPT-5 / o-series
- Claude 原生 adaptive/manual thinking 全量映射
- cheap-model routing
- delegation reasoning 继承
- CLI `/reasoning` 命令

## 进入 x-req 前的准入条件

每个 task 在进入 x-req 前，应先锁定：

1. 使用的最终模型名匹配规则
2. 是否需要新的 config schema
3. 是否增加新的 provider adapter
4. 对应的最小测试矩阵

## 与当前 CR 的关系

V1 完成后，必须同时消化以下两条现有缺口：

1. reasoning 测试覆盖真实失配路径
2. bootstrap/hash 测试覆盖真实 session 持久化路径
