# workspace-shell Task Map

## task 总览

| 模块 | 建议 task 名 | 前置依赖 | 是否可进 x-req | 说明 |
|---|---|---|---|---|
| workspace-shell-layout | `web-workspace-shell-layout` | 无 | 是 | 四 tab 壳层与主区头部 |
| workspace-context-store | `web-workspace-context-store` | 无 | 是 | thread-first workspace 状态树 |
| workspace-files | `web-workspace-files-explorer` | `layout` + `context-store` | 是 | 文件树、文件读取、文件编辑 |
| workspace-git | `web-workspace-git-panel` | `context-store` | 是 | status/diff/history/branches |
| workspace-shell | `web-workspace-shell-panel` | `context-store` | 是 | WS/PTY shell 面板 |
| workspace-backend-shared | `web-workspace-backend-shared` | 无 | 是 | context 路由、路径校验、repo 发现 |

## 推荐拆分顺序

### 第一批

1. `web-workspace-context-store`
2. `web-workspace-shell-layout`
3. `web-workspace-backend-shared`

这三项完成后，壳层、状态与后端公共边界就稳定了。

### 第二批

4. `web-workspace-files-explorer`

这是最先该落地的业务面板，因为它直接解决“切换到文件目录查看”。

### 第三批

5. `web-workspace-git-panel`
6. `web-workspace-shell-panel`

这两项可以并行进入 x-req。

## x-req 准入判断

### 可立即进入 x-req 的模块

- `web-workspace-shell-layout`
- `web-workspace-context-store`
- `web-workspace-backend-shared`
- `web-workspace-files-explorer`
- `web-workspace-git-panel`
- `web-workspace-shell-panel`

### 推荐先做的 x-req

优先级建议：

1. `web-workspace-files-explorer`
2. `web-workspace-git-panel`
3. `web-workspace-shell-panel`

## 当前建议

进入下一阶段时，建议先开一个合并型 x-req：

- `web-workspace-shell-foundation`

包含：

- `layout`
- `context-store`
- `backend-shared`

随后独立拆三个功能型 x-req：

- `web-workspace-files-explorer`
- `web-workspace-git-panel`
- `web-workspace-shell-panel`
