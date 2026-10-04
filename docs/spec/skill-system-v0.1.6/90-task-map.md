# Task Map

## 推荐方案：3 个 task 细粒度

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 |
|------|--------------|---------------|----------|----------|
| A. skill-loader | `skill-loader-v0.1.6` | 是 | 无 | 可进入 x-req |
| B. skill-tool（含 C safety） | `skill-tool-v0.1.6` | 是 | A 完成 | 可进入 x-req（待 A 落地） |
| D. 装配集成 | `skill-assemble-v0.1.6` | 是 | A、B、C 完成 + v0.1.5 web-runtime-factory 模块 1 | 可进入 x-req（待前置） |

## 备选方案：1 个 task 紧凑模式

| 模块合集 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 |
|----------|--------------|---------------|----------|----------|
| A + B + C + D 全部 | `skill-system-v0.1.6` | 是 | v0.1.5 web-runtime-factory 模块 1 | 可进入 x-req（待前置） |

紧凑模式适用场景：作为单 PR 一次性提交可接受，CR 边界容忍度高，开发者愿意一口气吞下 ~600 LOC + 测试。

细粒度模式适用场景：希望每个 task CR 独立、便于回滚、loader 可作为 v0.2 路径条件激活的复用基础（提前打好接口）。

## 推荐：细粒度

理由：

1. **Loader 是公共库性质**——v0.2 路径条件激活、v0.2 增量通知都基于 SkillSpec / load_skill_specs，独立成 task 让 API 边界提前清晰
2. **Tool + Safety 强耦合**——这两个是同一安全切片，不应分开
3. **Assemble 是装配收尾**——独立成 task 便于 e2e 验证（手跑 CLI 看 listing 是否进 system prompt + 模型真能 tool_call）

## Task 间依赖时序

```
v0.1.5 web-runtime-factory-v0.1.5 模块 1
  (assemble_instructions 公共函数)
      │
      └──┐
         │
[Wave 1] skill-loader-v0.1.6 (模块 A)            ← 可立即开
            │
            ├──→ [Wave 2] skill-tool-v0.1.6 (B + C)   ← A 完成后
            │
            └──→ [Wave 3] skill-assemble-v0.1.6 (D)   ← A + B + C 完成后
```

A 可与 v0.1.5 模块 1 **并行**（loader 不依赖 assemble_instructions 签名扩展，只在 D 阶段才接入）。

## 单 task 工作量估算

| Task | LOC（含测试） | 预估工作量 |
|------|---------------|-----------|
| skill-loader-v0.1.6 | ~250 | 0.5 个工作日 |
| skill-tool-v0.1.6 | ~280 | 0.5 个工作日 |
| skill-assemble-v0.1.6 | ~150（主要是接入点 + e2e 测试） | 0.5 个工作日 |
| **合计** | **~680** | **~1.5 个工作日** |

## v0.1.6 完整版本范围确认

v0.1.6 = skill 系统全部 4 个模块（A + B + C + D）。

**不要**把以下合入 v0.1.6（v0.2+ 范围）：

- listing 预算截断（`SKILL_BUDGET_CONTEXT_PERCENT * ctx`）
- `allowed-tools` 真正改写
- `paths` 路径条件激活
- fork 子运行时
- `disable-model-invocation` / `user-invocable` 字段消费
- managed / MCP / plugin 加载源
- skill 热重载（watcher）
- compaction 锚点重注入

## 进入 x-req 的清单

每个 task 在开 x-req 之前需要确认：

| Task | 前置检查清单 |
|------|------------|
| skill-loader-v0.1.6 | ☐ pyyaml 已在 pyproject.toml 依赖里（项目已有） |
| skill-tool-v0.1.6 | ☐ skill-loader-v0.1.6 已合并 ☐ `core.contracts.Tool` 接口支持 `_required_capability` 模式（已有） |
| skill-assemble-v0.1.6 | ☐ skill-loader-v0.1.6 已合并 ☐ skill-tool-v0.1.6 已合并 ☐ web-runtime-factory-v0.1.5 模块 1 已合并 |

## 下一步建议

1. **立即可做**：
   - 开 `skill-loader-v0.1.6` 的 x-req（独立无依赖）
   - 等 v0.1.5 web-runtime-factory 模块 1 落地后再开 `skill-assemble-v0.1.6`

2. **不建议**：
   - 把 v0.1.6 合并到 v0.1.5 一起发——目标不同，回滚边界混乱
   - 单 task 紧凑模式——除非赶版本，否则细粒度对 CR 更友好

3. **风险提示**：
   - 模块 D（装配集成）的 `assemble_instructions` 签名扩展会动到 v0.1.5 刚落地的公共函数——CLI 与 web 同时改，需要在 task 文档里明确"双侧同改"
