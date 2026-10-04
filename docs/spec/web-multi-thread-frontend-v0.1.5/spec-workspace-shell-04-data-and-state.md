# workspace-shell 数据与状态

## 1. 核心实体

### 1.1 ThreadMetadataDTO

当前已存在字段：

- `id`
- `name`
- `backend_kind`
- `claude_thread_id`
- `codex_thread_id`
- `cwd`

代码依据：

- [src/web/thread_metadata.py](/Volumes/machub_app/proj/kongming-agent/src/web/thread_metadata.py)
- [web/src/protocol.ts](/Volumes/machub_app/proj/kongming-agent/web/src/protocol.ts)

### 1.2 WorkspaceContext

新增前端状态实体：

```ts
interface WorkspaceContextState {
  threadId: string | null;
  workspaceRoot: string | null;
  activeTab: "chat" | "files" | "git" | "shell";
  files: FilesPanelState;
  git: GitPanelState;
  shell: ShellPanelState;
}
```

### 1.3 FilesPanelState

```ts
interface FilesPanelState {
  treeRootPath: string;
  expandedDirs: string[];
  searchQuery: string;
  selectedPath: string | null;
  openedFile: OpenFileBuffer | null;
  loadingTree: boolean;
  loadingFile: boolean;
}

interface OpenFileBuffer {
  path: string;
  mimeType: string;
  encoding: "utf-8" | "binary";
  content: string;
  dirty: boolean;
  readonly: boolean;
  lastSavedAt: number | null;
}
```

### 1.4 GitPanelState

```ts
interface GitPanelState {
  activeView: "changes" | "history" | "branches";
  repoRoot: string | null;
  currentBranch: string | null;
  changedFiles: GitChangedFile[];
  selectedDiffPath: string | null;
  loading: boolean;
}
```

### 1.5 ShellPanelState

```ts
interface ShellPanelState {
  sessionId: string | null;
  connectionState: "idle" | "connecting" | "open" | "closed" | "error";
  cwd: string | null;
  lines: ShellLine[];
}

interface ShellLine {
  id: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
  ts: number;
}
```

## 2. workspace root 解析规则

推荐规则：

1. 若 `thread.cwd` 非空，直接使用 `thread.cwd`
2. 若 `thread.cwd` 为空且是 `generic_chat` thread，使用创建 thread 时持久化的 `cwd`
3. 若还为空，主区域显示“当前 thread 尚未绑定 workspace”

这意味着一个小的基础演进：

- `cwd` 从 `claude_code` 专属字段升级成通用 workspace 字段

这是本方案最关键的自有决策之一，因为它让 Files / Git / Shell 能服务所有 thread。

## 3. REST 路由合同

推荐全部挂在 `thread` 下：

### 3.1 workspace context

- `GET /api/threads/{thread_id}/workspace/context`

```json
{
  "thread_id": "thread-abc123def456",
  "workspace_root": "/Volumes/machub_app/proj/kongming-agent",
  "capabilities": {
    "files": true,
    "git": true,
    "shell": true
  },
  "git_repo_root": "/Volumes/machub_app/proj/kongming-agent"
}
```

### 3.2 files

- `GET /api/threads/{thread_id}/workspace/tree?path=src/web`
- `GET /api/threads/{thread_id}/workspace/file?path=src/web/run.py`
- `PUT /api/threads/{thread_id}/workspace/file`
- `POST /api/threads/{thread_id}/workspace/mkdir`
- `POST /api/threads/{thread_id}/workspace/upload`
- `POST /api/threads/{thread_id}/workspace/rename`
- `DELETE /api/threads/{thread_id}/workspace/path?path=...`

### 3.3 git

- `GET /api/threads/{thread_id}/workspace/git/status`
- `GET /api/threads/{thread_id}/workspace/git/diff?path=...`
- `GET /api/threads/{thread_id}/workspace/git/history`
- `GET /api/threads/{thread_id}/workspace/git/branches`
- `POST /api/threads/{thread_id}/workspace/git/stage`
- `POST /api/threads/{thread_id}/workspace/git/unstage`
- `POST /api/threads/{thread_id}/workspace/git/commit`
- `POST /api/threads/{thread_id}/workspace/git/fetch`
- `POST /api/threads/{thread_id}/workspace/git/pull`
- `POST /api/threads/{thread_id}/workspace/git/push`

### 3.4 错误模型

统一返回：

```json
{
  "error_code": "internal",
  "message": "workspace path out of root",
  "details": {
    "path": "../.."
  }
}
```

## 4. Shell WS 协议合同

推荐独立 endpoint：

- `WS /ws/workspace-shell?thread_id=...`

原因：

- 聊天帧与 shell 帧生命周期不同
- Claude Code WS 与 generic chat WS 已经分流
- Shell 单独建协议层更简单

### 4.1 C2S

```ts
type ShellClientFrame =
  | { kind: "shell.open" }
  | { kind: "shell.input"; data: string }
  | { kind: "shell.resize"; cols: number; rows: number }
  | { kind: "shell.close" };
```

### 4.2 S2C

```ts
type ShellServerFrame =
  | { kind: "shell.ready"; session_id: string; cwd: string }
  | { kind: "shell.output"; stream: "stdout" | "stderr"; data: string }
  | { kind: "shell.exit"; exit_code: number | null }
  | { kind: "shell.error"; message: string };
```

## 5. 参考方案与本方案的状态树对比

| 主题 | `ccui` | 本方案 |
|---|---|---|
| 顶层上下文 | `selectedProject + selectedSession + activeTab` | `threadId + workspaceRoot + activeTab` |
| 文件打开状态 | editor sidebar store | `FilesPanelState.openedFile` |
| Git 状态 | git panel controller | `GitPanelState` |
| Shell 状态 | shell runtime state | `ShellPanelState` |

## 6. 简化原则

- 首版只维护一个活动 workspace
- 首版只维护一个活动 shell session
- 首版只维护一个活动 opened file
- 首版让 Git 面板先支持常用主路径
- 首版让二进制文件走只读提示
