# 司天 prompt 注入

> 状态：可拆 task
> 目标：将 workspace_state 作为 instruction source 注入 agent system prompt，让 LLM 具备跨项目视野

## 系统目标

agent 当前只感知"眼前的项目"——它不知道工作区里还有哪些项目、哪些项目卡住了、哪些项目长期沉默。司天已经把这些事实扫描出来了（workspace_state.json），但数据停在文件里，agent 看不到。

本 spec 把司天的全局态势注入 system prompt，让 LLM 在推理时自然消费这些上下文。用户问"接下来做什么"时，LLM 自己就能跨项目推理。

## 最小可用路径

```
agent 启动 → 读 workspace_state.json → 格式化为文本 → 注入 system prompt（origin="sitian"）
→ 用户问"我该做什么" → LLM 看到 10 个项目的态势 → 给出跨项目建议
```

## 范围边界

**包含**：

- 读 workspace_state.json + latest_summary.md + latest_analysis.md
- 格式化为人类可读文本（带 freshness 时间戳）
- 作为公共 instruction source 注入（CLI + Web 均受益）
- 文件不存在时静默降级

**不包含**：

- 不改建议引擎（if/else 保持不变）
- 不调 LLM 做预计算建议
- 不读 thread 内容做深度总结
- 不新增配置开关（有数据就注入）

## 组件导航

| 组件 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| sitian_context 纯函数 | 可进入 x-req | `./02-module-breakdown.md` | 是 | context 层新增文件 |
| assemble_instructions 扩展 | 可进入 x-req | `./02-module-breakdown.md` | 是 | 公共函数加参数 |
| CLI/Web 装配层适配 | 可进入 x-req | `./02-module-breakdown.md` | 是 | 调用方传 sitian_root |

## 文档导航

- [架构图](./architecture.html)（浏览器双击打开）
- [目标与完成标准](./01-goals-and-boundaries.md)
- [组件设计](./02-module-breakdown.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 三个组件无前置依赖，可合并为一个 task 直接进 x-req
2. 改动量 ~50 行代码 + 测试，适合 x-qdev 级别快速开发
