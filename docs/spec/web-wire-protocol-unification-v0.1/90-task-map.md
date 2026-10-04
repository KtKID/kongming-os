# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| Web Protocol Models | `web-wire-protocol-models-v0.1` | 无 | DoD#1、DoD#4 | 高 | 可进入 x-req | 前置所有任务，先稳定模型与 union |
| Protocol Frame Emission | `web-wire-protocol-emitters-v0.1` | Models | DoD#2、DoD#4、DoD#5 | 中 | 可进入 x-req | 覆盖 thread_status、global_inbox、Claude/Codex service、Codex route |
| Frontend Wire Consumers | `web-wire-protocol-consumers-v0.1` | Models | DoD#3、DoD#4、DoD#6 | 中 | 可进入 x-req | hook/socket/store 迁到 `@/protocol` |
| Protocol Drift Tests | `web-wire-protocol-drift-tests-v0.1` | Models 初版 | DoD#5、DoD#6、DoD#7 | 中 | 可进入 x-req | 可与 emitters/consumers 并行补齐 |
| Protocol Docs Alignment | `web-wire-protocol-docs-v0.1` | Models + Emitters + Consumers | DoD#8 | 低 | 可进入 x-req | 实现收尾后更新模块文档 |

## 建议开发顺序

1. `web-wire-protocol-models-v0.1`：定义 Python/TS 双侧模型、endpoint union、导出入口和 `frame_type` 判别规则，迁入 app_support/codex-ws 局部 frame 语义。
2. `web-wire-protocol-emitters-v0.1`：替换后端裸 dict 发送端，`usage_summary_updated` 输出 `frame_type`，route/service tests 跟随调整。
3. `web-wire-protocol-consumers-v0.1`：前端 hook/socket/store 改为从 `@/protocol` 导入 wire 类型，`useThreadStatusWS` 只按 `frame.frame_type` 分派。
4. `web-wire-protocol-drift-tests-v0.1`：建立 Python/TS fixture/hash 漂移检查和 import-boundary 扫描，覆盖 adapter、route、hook、Codex socket。
5. `web-wire-protocol-docs-v0.1`：更新 Web 模块文档和相关引用，清理旧 `kind`、旧帧数、局部真源描述。

## PoC 建议

最低 PoC：新增 `UsageSummaryUpdatedFrame(frame_type, threadId, usage)`，同步 TS `protocol.ts`；`useThreadStatusWS` 去掉 `data.type` 分支；补一个 usage service test 和一个 hook test。该 PoC 先证明双侧模型、后端发送端、前端分派和测试 gate 能闭环。

## 主要文件改动与验收 gate

| task | 主要文件改动 | 验收 gate |
|------|--------------|-----------|
| `web-wire-protocol-models-v0.1` | `repo:src/hosts/web/protocol/`、`repo:src/hosts/web/protocol/__init__.py`、`repo:src/hosts/web/protocol/ws_frames.py`、`repo:web/src/protocol.ts` | Python/TS `frame_type` 集合一致；endpoint C2S/S2C union 导出；adapter round trip/rejection 覆盖新增帧 |
| `web-wire-protocol-emitters-v0.1` | `repo:src/hosts/web/websocket/thread_status.py`、`repo:src/hosts/web/approvals/global_inbox/broadcaster.py`、`repo:src/hosts/web/integrations/claude_code/service.py`、`repo:src/hosts/web/integrations/codex/service.py`、Codex/Claude route/service | 相关发送端没有裸拼关键 frame dict；usage、thread-status、approval inbox route/service tests 断言协议模型输出 |
| `web-wire-protocol-consumers-v0.1` | `repo:web/src/hooks/useThreadStatusWS.ts`、`repo:web/src/features/approval-inbox/types.ts`、`repo:web/src/lib/codex-ws.ts`、Claude/Codex providers | `useThreadStatusWS` 没有 `data.type` 分支；局部文件只保留 view/store/socket 类型；wire union 只从 `@/protocol` 导入 |
| `web-wire-protocol-drift-tests-v0.1` | Python adapter/route tests、frontend hook/type tests、import-boundary test、Python/TS fixture/hash 检查 | 新增/修改 frame 缺 Python/TS 双侧 fixture 时失败；feature/lib 局部 wire union 复生时失败 |
| `web-wire-protocol-docs-v0.1` | `repo:docs/modules/Web前端/README.md`、相关旧 spec/task 引用 | 文档描述使用 `frame_type` 和双侧真源；旧 `kind`、旧帧数、局部类型真源描述完成清理 |

## 任务拆分边界

| task | 输入 | 输出 | 完成信号 |
|------|------|------|----------|
| Models | 现有 Python protocol、TypedDict、TS protocol、局部 union | 双侧模型、adapter、endpoint union、导出入口 | DoD#1、DoD#4 模型部分通过 |
| Emitters | Models 输出和现有发送端 | 发送端模型构造/校验、`model_dump()` 输出 | DoD#2、DoD#5 后端部分通过 |
| Consumers | Models 输出和现有 hook/socket/store | `@/protocol` 导入边界、`frame_type` 分派 | DoD#3、DoD#6 前端部分通过 |
| Drift Tests | Models + 初步迁移路径 | drift fixture/hash、import-boundary、adapter/route/hook tests | DoD#7 通过 |
| Docs | 已稳定实现和测试 | Web 模块文档对齐 | DoD#8 通过 |

## 仍留在方案层的问题

- 自动代码生成是否进入 v0.2，需要在 v0.1 手写同步和漂移测试稳定后评估。
- Python/TS 字段命名是否统一 snake/camel，需要逐帧基于既有 wire 兼容面决定。
- `WebFrameEmitter` 是否作为独立类落地，或先用协议模型工厂方法分散在发送端，x-req 阶段根据重复度确定。

## 进入 x-req 的模块

Web Protocol Models、Protocol Frame Emission、Frontend Wire Consumers、Protocol Drift Tests 都适合进入 x-req。Protocol Docs Alignment 可作为收尾 task 进入 x-req，执行顺序排在实现任务之后。
