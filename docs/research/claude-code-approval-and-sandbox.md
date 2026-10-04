# Claude Code 工具批准与沙盒模式调研

> 生成时间：2026-04-25
> 调研范围：`other/claude-code-main/`
> 目的：为 kongming-agent 安全链（capability → permission → approval）的演进做参考对照

---

## 1. 批准（Permission / Approval）流程

### 1.1 权限模式架构

Claude Code 定义了多个权限模式（`PermissionMode`）：

- **default**：逐工具决策
- **plan**：暂停模式，要求明确批准
- **acceptEdits**：自动接受编辑工具
- **bypassPermissions**：绕过所有权限提示
- **dontAsk**：拒绝所有非配置权限
- **auto**（Ant 内部）：基于分类器的自动评估

关键文件：`src/types/permissions.ts:16-38`、`src/utils/permissions/PermissionMode.ts:44-91`

### 1.2 决策链：三段式批准

工具调用时流经 `hasPermissionsToUseTool()` → `PermissionDecision<T>` → 返回 `allow | ask | deny`

- **allow 决策路径**：`PermissionAllowDecision`（`src/types/permissions.ts:174-184`）
  - 规则匹配（allow/deny rules）或模式直接允许
  - 支持 `updatedInput`（用户交互修改后的参数）

- **ask 决策路径**：`PermissionAskDecision`（`src/types/permissions.ts:199-226`）
  - 调用 `handleInteractivePermission()` 弹出交互式确认
  - 支持异步分类器检查（`pendingClassifierCheck`）
  - 提供建议规则列表（`suggestions`）

- **deny 决策路径**：`PermissionDenyDecision`（`src/types/permissions.ts:231-236`）
  - 拒绝并返回错误信息

关键文件：`src/hooks/useCanUseTool.tsx:27-92`（权限决策的 React Hook）

### 1.3 规则的层级与来源（PermissionRuleSource）

- **userSettings**：全局用户配置（`~/.claude/settings.json`）
- **projectSettings**：项目配置（`.claude/settings.json`）
- **localSettings**：会话本地配置
- **flagSettings**：CLI 标志（`--allow Bash:*`）
- **policySettings**：组织策略（**最高优先级**）
- **cliArg**、**command**、**session**：运行时源

规则形式：`Permission(...): rule_content`，例如 `Edit(./src/**)` 或 `Bash(git:*)`

关键文件：`src/types/permissions.ts:54-79`

### 1.4 工具粒度的权限匹配

以 Bash 为例，支持三种规则模式：

1. **精确匹配**：`Bash(npm test)` → 仅该命令
2. **前缀匹配**：`Bash(npm run:*)` → npm run <any>
3. **通配符**：`Bash(*.py)` → 文件路径模式

匹配逻辑处理 safe env vars（如 `NODE_ENV`）和 wrapper 剥离（timeout、env）

关键文件：`src/tools/BashTool/bashPermissions.ts:160-188`、`src/utils/permissions/shellRuleMatching.ts`

### 1.5 记住选择的持久化

用户在 ask 对话框选择后，系统可调用 `persistPermissionUpdate()`：

- `type: 'addRules'` → 添加新规则到指定源（userSettings / projectSettings / localSettings）
- `type: 'setMode'` → 切换权限模式
- 支持 `replaceRules` 和 `removeRules`

持久化会立即写入 settings.json（via `updateSettingsForSource()`）

关键文件：`src/utils/permissions/PermissionUpdate.ts:208-258`

### 1.6 "自动允许" 的实现

- **bypassPermissions 模式**：所有工具无条件通过（高风险）
- **acceptEdits 模式**：编辑工具自动允许，其他工具仍需提示
- **autoAllowBashIfSandboxed**：当沙盒启用时，Bash 命令自动允许（`src/utils/sandbox/sandbox-adapter.ts:469-472`）
- **Auto 分类器**（内部）：使用 Yolo 分类器在 LLM 进行二阶段评估（快速 + 思考）

---

## 2. 沙盒模式（Sandbox）

### 2.1 沙盒概念与启用条件

沙盒由 `@anthropic-ai/sandbox-runtime` 提供，Claude Code 通过适配层整合。启用条件：

1. 用户显式配置 `sandbox.enabled: true`
2. 平台支持（macOS / Linux / WSL2，不支持 WSL1）
3. 依赖可用（macOS 原生，Linux 需 bubblewrap + socat）
4. 不在 enabledPlatforms 黑名单（用于分阶段推出）

关键文件：`src/utils/sandbox/sandbox-adapter.ts:459-547`

### 2.2 沙盒保护范围（分层限制）

#### 文件系统（`sandbox-adapter.ts:369-374`）

- `allowWrite` / `denyWrite`：从 Edit 权限规则和 `sandbox.filesystem` 配置解析
- `denyRead`：保护敏感路径（`.claude/`、`.git/`、settings 文件）
- 特殊处理：自动为 CWD 和 Claude temp 目录设置 `allowWrite`
- Git worktree 检测：自动允许 worktree 的主仓库（`.git` 目录）

#### 网络（`sandbox-adapter.ts:360-368`）

- `allowedDomains` / `deniedDomains`：从 WebFetch 权限规则和 `sandbox.network` 配置
- `allowManagedDomainsOnly`：组织策略可锁定为管理域名白名单
- Unix Socket 和本地绑定支持（HTTP / SOCKS 代理）

#### 程序

- `excludedCommands`：用户可配置不进沙盒的命令（**便利特性，非安全边界**）
- `dangerouslyDisableSandbox`：工具参数可显式关闭沙盒（需策略允许）

关键文件：`src/utils/sandbox/sandbox-adapter.ts:172-381`、`src/tools/BashTool/shouldUseSandbox.ts:130-153`

### 2.3 沙盒与批准的联动

```
Bash 命令 → shouldUseSandbox() 检查是否启用
  ↓
  沙盒启用 → 自动 allow（如 autoAllowBashIfSandboxed=true）
  沙盒禁用 → 回到权限规则流（ask / deny）
  excludedCommands 匹配 → 跳过沙盒，仅权限检查
```

关键文件：`src/tools/BashTool/bashPermissions.ts:79`（shouldUseSandbox 调用）

### 2.4 平台差异

- **macOS**：使用原生沙盒（`sandbox-exec`），自动启用日志监控
- **Linux**：使用 bubblewrap（`bwrap`），支持 bind-mount 文件系统限制
- **WSL2**：同 Linux（bwrap 方案）
- **Windows / WSL1**：不支持

关键文件：`src/utils/sandbox/sandbox-adapter.ts:569-589`（警告处理）

### 2.5 沙盒配置的热更新

订阅 `settingsChangeDetector`，当用户修改 settings.json 时：

1. `convertToSandboxRuntimeConfig()` 重新解析规则
2. `BaseSandboxManager.updateConfig()` 更新运行时配置
3. 下一条 Bash 命令自动采用新限制

关键文件：`src/utils/sandbox/sandbox-adapter.ts:776-781`

### 2.6 安全强化：防 Git 字典攻击

特殊防御（SECURITY 注释）：若恶意脚本在 CWD 植入 HEAD / objects / refs，可能被 unsandboxed git 误认为是 bare repo。Claude Code 的处理：

1. 检查这些文件是否存在
2. 若存在，加入 `denyWrite`（只读挂载）
3. 若不存在，记录路径，命令后清理（`scrubBareGitRepoFiles()`）

关键文件：`src/utils/sandbox/sandbox-adapter.ts:257-280`

---

## 3. 用户交互与决策

### 3.1 ask 对话框的 UI 呈现

当权限返回 `PermissionAskDecision` 时，`handleInteractivePermission()` 推送确认项到 `toolUseConfirmQueue`：

- 展示工具名 + 说明 + 参数摘要
- 提示：发生了什么，为什么需要批准
- 建议：预先生成的规则选项（如 "Allow for all git commit:*"）

关键文件：`src/hooks/toolPermission/handlers/interactiveHandler.ts:57-150`

### 3.2 批准选项

React 回调提供的选项：

- **onAllow**：一次性允许 + 应用 `updatedInput`（如用户修改的 Bash 命令）
- **onReject**：拒绝，返回 error tool_result
- **recheckPermission**：重新运行权限逻辑（规则变更后）
- **onUserInteraction**：200ms 宽限期后清除分类器指示

关键文件：`src/hooks/toolPermission/handlers/interactiveHandler.ts`

### 3.3 拒绝时的 LLM 反馈

拒绝返回 `PermissionDenyDecision` 含 `message` 字段，最终作为 tool_result 发回 LLM：

- "Permission denied: Bash commands require explicit approval"
- "Auto mode denied because: Modifying system files outside home dir"（分类器拒绝）

LLM 可据此调整策略或提示用户。

关键文件：`src/utils/permissions/permissions.ts:137-200`（`createPermissionRequestMessage`）

---

## 4. 对照 kongming-agent 的启示

**当前 kongming 的三段链**：`capability_policy` → `permission_policy` → `approval`（`src/safety/chain.py::SafetyGatedApproval`）

### 4.1 维度对照

| 维度 | Claude Code | kongming 建议 |
|------|------------|--------------|
| 权限模式 | 5 种（default/plan/acceptEdits/bypassPermissions/dontAsk） | 考虑增加模式多样性，尤其是 plan 模式（暂停评估）和 acceptEdits（编辑直放） |
| 规则层级 | 5 源头（user/project/local/flag/**policy**） | 已有三层，可参考 **policySettings** 锁死位（组织级最高优先级） |
| 规则粒度 | 工具 + 内容（`Bash(git:*)`） | 内容匹配逻辑可借鉴 prefix `:*` / wildcard 方案 |
| 记住选择 | `persistPermissionUpdate()` → settings.json | 已有持久化，强化即时刷新配置的机制 |
| 沙盒 | 文件 + 网络 + 程序三层隔离，平台适配 | **缺失**：可评估成本收益，至少针对 Bash 引入文件系统沙盒（macOS `sandbox-exec` / Linux `bwrap`） |
| 沙盒 + 批准 | 沙盒启用 → 自动 allow；沙盒排除 → 仅权限检查 | 可复用这种联动逻辑，嵌入 `SafetyGatedApproval` |
| 分类器 | Yolo 分类器（2 阶段），async 非阻塞 | 如引入 LLM 分类，参考 `pendingClassifierCheck` 的设计 |
| `updatedInput` | 用户在 ask 阶段可改写参数 | 当前 approval 不支持参数改写，可作为后续增强 |

### 4.2 关键文件位置汇总

| 主题 | 路径 |
|------|------|
| 权限决策 | `src/utils/permissions/permissions.ts`（`hasPermissionsToUseTool`） |
| 权限模式 | `src/types/permissions.ts`（`PERMISSION_MODES`） |
| 沙盒适配 | `src/utils/sandbox/sandbox-adapter.ts`（`convertToSandboxRuntimeConfig`） |
| 交互流 | `src/hooks/useCanUseTool.tsx`（React 权限 Hook） |
| Bash 权限 | `src/tools/BashTool/bashPermissions.ts` |
| 持久化 | `src/utils/permissions/PermissionUpdate.ts:208-258` |

---

## 5. 后续可推进项

1. **plan 模式落地**：在 SafetyGatedApproval 上层加一个"暂停评估"开关，所有工具走 ask
2. **policy 层引入**：在 permission_policy 上方加只读组织策略源，无法被项目级覆盖
3. **沙盒 PoC**：先在 macOS 用 `sandbox-exec` 包裹 Shell tool，Linux 用 `bwrap`，作为可选 capability
4. **autoAllowIfSandboxed**：沙盒启用时 Shell 自动 allow，等价于把"安全边界"从批准链转移给沙盒
5. **拒绝消息标准化**：approval 拒绝时返回结构化 reason，便于 LLM 调整策略

---

> 调研由 Explore agent 完成，原始引用全部保留在本文件中。
