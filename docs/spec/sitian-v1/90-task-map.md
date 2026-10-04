# Task Map

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 |
|------|--------------|----------------|----------|----------|
| 观察源配置 | `sitian-v1-source-config` | 是 | 无 | 可进入 x-req |
| 主动扫描器 | `sitian-v1-active-scanner` | 是 | `sitian-v1-source-config` | 可进入 x-req |
| 司天录存储 | `sitian-v1-records-store` | 是 | `sitian-v1-source-config` | 可进入 x-req |
| 建议引擎 | `sitian-suggestions-fix` | 是 | `sitian-v1-active-scanner`, `sitian-v1-records-store` | **开发中** — claude_workspace per-project 展开 |
| 控制面展示 | `sitian-v1-read-model-and-ui` | 否 | `sitian-v1-suggestion-engine` | 方案确认 |

## 推荐拆分顺序

1. 先做 `sitian-v1-source-config`
2. 再做 `sitian-v1-records-store`
3. 然后做 `sitian-v1-active-scanner`
4. 最后做 `sitian-v1-suggestion-engine`

## 模块进入 x-req 的建议

适合先进入 `x-req` 的模块：

- 观察源配置
- 司天录存储
- 主动扫描器
- 建议引擎

继续留在方案层的模块：

- 控制面展示
