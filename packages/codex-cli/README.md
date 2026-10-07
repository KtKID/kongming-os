# @kmh/codex-cli

KMH 的官方 Codex CLI 模型提供方插件。通过 `codex app-server --stdio` 行协议接入本机 Codex CLI：KMH 负责技能、工具权限与工具执行，Codex 保留内部模型续推与原生历史管理。

需求与验收场景见 [docs/spec/codex-cli-provider/spec.md](../../docs/spec/codex-cli-provider/spec.md)。

## 使用

- 需要本机安装受支持版本的官方 Codex CLI（首个支持基线 0.160.0）。
- 共享用户 `~/.codex` 的 Codex 登录与配置，无需额外登录；登录状态按本地凭据文件存在性判定。用户配置的 MCP 设备随之对模型可见。
- 一切隔离配置经进程 `-c` 参数注入，只影响单次调用，不修改任何 Codex 配置文件。
- 默认只使用 KMH 的工具与技能（原生 shell、改文件、多 agent、原生技能与 `$/技能名` 调用均已关闭），可在插件详情页开启原生工具与技能。
- 上下文压缩由 Codex 原生处理；KMH 侧压缩请求被明确拒绝（错误码见 adapter）。

## 配置

| 配置                  | 默认               | 说明                                |
| --------------------- | ------------------ | ----------------------------------- |
| `command`             | `codex`            | 官方 CLI 可执行文件，可指定绝对路径 |
| `cwd`                 | 必填               | 无会话身份时子进程的工作目录        |
| `dataDir`             | 必填               | 插件数据目录（绑定记录等）          |
| `nativeToolsEnabled`  | `false`            | 原生 Codex 工具与技能开关           |
| `startupTimeoutMs` 等 | 见 `src/config.ts` | 启动、请求、取消回执与清理时限      |

## 开发

`pnpm build` 构建 Host 产物；`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 为对应检查。测试位于主仓 `tests/runtime/codex-cli.test.mjs`。
