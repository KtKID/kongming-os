# Task Map

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 |
|------|--------------|----------------|----------|----------|
| A. Snapshot Semantics | `backend-runtime-status-domain` | 是 | 无 | 可进入 x-req |
| B. Runtime Collectors | `backend-runtime-status-collectors` | 是 | A | 可进入 x-req |
| C. Aggregation API | `backend-runtime-status-api` | 是 | A + B | 可进入 x-req |
| D. CLI Surface | `backend-runtime-status-cli` | 是 | C | 可进入 x-req |
| E. Web Status Page | `backend-runtime-status-web` | 是 | C | 方案确认 |
| workspace-shell registry（可选增强） | `backend-runtime-status-shell-registry` | 否 | B | 方案层保留 |

## 推荐拆分

### 第一批

1. `backend-runtime-status-domain`
2. `backend-runtime-status-collectors`
3. `backend-runtime-status-api`

这三项先把“统一口径 + 真值来源 + REST 快照”收稳。

### 第二批

1. `backend-runtime-status-cli`
2. `backend-runtime-status-web`

这两项都是消费层，依赖第一批的字段冻结。

## 哪些模块可以先进入 x-req

- A. Snapshot Semantics
- B. Runtime Collectors
- C. Aggregation API
- D. CLI Surface

## 哪些模块继续停留在方案层

- E. Web Status Page 里的实时刷新策略细节
- `workspace-shell` 全局连接 registry

## 推荐开发顺序

1. A：先冻结术语和字段
2. B：把现有对象计数接出来
3. C：输出统一快照 API
4. D：接 CLI
5. E：接 `/manage` 页面
