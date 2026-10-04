# web-wire-protocol-unification-v0.1

> 状态：方案确认
> 目标：将 Web wire 协议收敛到 Python `repo:src/hosts/web/protocol/` 与 TypeScript `repo:web/src/protocol.ts` 双侧真源，覆盖 thread-status、approval inbox、usage refresh、Claude Code 与 Codex endpoint 帧，并用发送端校验、前端导入边界和漂移测试防止字段分叉。

## 系统目标

Web wire 协议当前分散在 Python protocol 包、局部 TypedDict、后端裸 dict 广播、前端 hook/socket 局部类型和 feature store 类型中。这个 spec 将协议真源明确为 Python Pydantic 模型与 TS 1:1 类型，所有 WebSocket/REST wire 帧统一使用 `frame_type` 判别，后端发送端通过协议模型构造或校验后输出，前端业务代码只从 `repo:web/src/protocol.ts` 导入 wire 类型。

## 最小可用路径

开发者新增或修改一个 Web wire 帧 → 在 `repo:src/hosts/web/protocol/` 定义 Pydantic 模型并在 `repo:web/src/protocol.ts` 增加同名 TS 类型 → 后端发送端用模型 `model_dump()` 输出 → 前端 hook 按 `frame.frame_type` 分派 → Python/TS 漂移与导入边界测试阻止局部 wire 类型复生。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| Web Protocol Models | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-1web-protocol-models) | 是 | Python/TS 双侧 wire DTO、endpoint union、导出入口 |
| Protocol Frame Emission | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-2protocol-frame-emission) | 是 | 后端发送端从协议模型构造或校验后 dump |
| Frontend Wire Consumers | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-3frontend-wire-consumers) | 是 | hook/socket/store 只消费 `@/protocol` wire 类型 |
| Protocol Drift Tests | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-4protocol-drift-tests) | 是 | Python adapter、route、TS 导入边界、fixture/hash 漂移检查 |
| Protocol Docs Alignment | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-5protocol-docs-alignment) | 是 | 更新模块文档和旧 spec 引用，消除 `kind` 与帧数漂移 |

## 文档导航

- [图集：总览、E2E 链路、修复主流程、模块局部图](./diagrams.md)
- [目标、边界与完成标准](./01-goals-and-boundaries.md)
- [模块拆分、边界入口与风险](./02-module-breakdown.md)
- [修复主流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

先进入 `web-wire-protocol-models-v0.1` 的 x-req，把 Python protocol 包、TS `protocol.ts`、endpoint C2S/S2C union、adapter 和 `frame_type` 集合定稳。Models gate 通过后，`web-wire-protocol-emitters-v0.1` 与 `web-wire-protocol-consumers-v0.1` 并行推进；`web-wire-protocol-drift-tests-v0.1` 作为阻断 gate，拦截裸 dict、双读分支和局部 wire union；`web-wire-protocol-docs-v0.1` 最后收尾。
