# Task Map

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 |
|------|--------------|----------------|----------|----------|
| Bootstrap 与 Session 工厂 | `file-session-bootstrap-bridge` | 是 | 无 | 可进入 x-req |
| FileSession 存储与落盘生命周期 | `file-session-materialization` | 是 | `file-session-bootstrap-bridge` | 可进入 x-req |
| 消息链模型与恢复校验 | `file-session-chain-recovery` | 是 | `file-session-materialization` | 可进入 x-req |
| Backend 接入与兼容性验证 | `file-session-backend-compat` | 是 | `file-session-bootstrap-bridge`, `file-session-materialization`, `file-session-chain-recovery` | 可进入 x-req |

## 拆分建议

### 第一批进入 x-req

- `file-session-bootstrap-bridge`
- `file-session-materialization`

这两个 task 形成主链路骨架，优先级最高。

### 第二批进入 x-req

- `file-session-chain-recovery`
- `file-session-backend-compat`

这两个 task 负责可靠性与版本收口，依赖前一批任务稳定落地。

## 版本推进建议

1. 先固化 `SessionBootstrap` 与 `session_factory` 的接口边界。
2. 再实现 `FileSession` 的 materialize 与 append-only 写入。
3. 然后补齐恢复、校验、损坏尾行容错。
4. 最后接入 `backend=file`、完成回归测试和样例文档。
