# KMH 与 DSH 基线差异台账（自动生成，勿手编）

> 由 `scripts/diff-with-dsh.mjs` 生成；基线 `/Volumes/machub_app/proj/agent/deepseek-harness`（提交 85805356）。
> 迁移策略：src 源码 1:1（零差异为硬约束）；清单（package.json 依赖区、tsconfig
> references）因未迁移包被单向修剪。**全部包迁完后，按本台账逐条回填清单并重跑脚本，
> 差异清零即与 DSH 基线完全一致。**类型检查集合外与测试排除的登记见交付报告：
> docs/architecture/kmh-dsh-foundation-migration.md。

- 已迁移包数：166 / DSH 全部包：329
- src 源码差异：0（必须为 0）
- 清单修剪条目：41
- 待迁移包：96；范围显式排除：67

## 待迁移包（DSH 有、KMH 无、范围文档未排除）

- ⬜ `packages/acp/acp`
- ⬜ `packages/api/account-controller`
- ⬜ `packages/api/gateway`
- ⬜ `packages/api/job-controller`
- ⬜ `packages/api/remotes`
- ⬜ `packages/api/session-controller`
- ⬜ `packages/api/settings-controller`
- ⬜ `packages/api/terminal-controller`
- ⬜ `packages/api/workspace-controller`
- ⬜ `packages/api/workspace-files`
- ⬜ `packages/browser-use/browser-use`
- ⬜ `packages/bundle/acp-app`
- ⬜ `packages/bundle/plugin-analyzer`
- ⬜ `packages/bundle/plugin-doctor`
- ⬜ `packages/bundle/sdk-app`
- ⬜ `packages/bundle/sdk-minimal`
- ⬜ `packages/computer-use/computer-use`
- ⬜ `packages/context/session-reference`
- ⬜ `packages/context/time-context`
- ⬜ `packages/context/tmux-context`
- ⬜ `packages/core/agent-tool-presentation`
- ⬜ `packages/deliverables/workspace-changes`
- ⬜ `packages/document/office-to-pdf`
- ⬜ `packages/experimental/agent-team`
- ⬜ `packages/experimental/agent-team-profile`
- ⬜ `packages/experimental/api-speech-to-text`
- ⬜ `packages/experimental/auto-review`
- ⬜ `packages/experimental/browser-use-chrome-devtools-mcp`
- ⬜ `packages/experimental/browser-use-playwright-mcp`
- ⬜ `packages/experimental/browser-use-runtime`
- ⬜ `packages/experimental/browser-use-stagehand-native`
- ⬜ `packages/experimental/client-ui-agent-team`
- ⬜ `packages/experimental/client-ui-voice-input`
- ⬜ `packages/experimental/computer-use-cua-driver-mcp`
- ⬜ `packages/experimental/computer-use-cua-driver-native`
- ⬜ `packages/experimental/inspector`
- ⬜ `packages/experimental/ptc-runtime-python`
- ⬜ `packages/experimental/speech-to-text`
- ⬜ `packages/experimental/speech-to-text-sensevoice`
- ⬜ `packages/experimental/tool-agent-team`
- ⬜ `packages/experimental/voice-input-bundle`
- ⬜ `packages/experimental/webworker-packer`
- ⬜ `packages/experimental/webworker-runtime`
- ⬜ `packages/extensions/cordis-host-runner`
- ⬜ `packages/extensions/tool-cordis`
- ⬜ `packages/extensions/ui-cordis`
- ⬜ `packages/fs/tool-str-replace-editor`
- ⬜ `packages/hooks/hook-protocol`
- ⬜ `packages/hooks/hooks-claude-code`
- ⬜ `packages/hooks/hooks-codex`
- ⬜ `packages/host/directory-picker`
- ⬜ `packages/host/directory-picker-auto`
- ⬜ `packages/host/directory-picker-browse`
- ⬜ `packages/host/directory-picker-native`
- ⬜ `packages/host/frontend-static`
- ⬜ `packages/host/open-in-app`
- ⬜ `packages/host/plugin-analyzer`
- ⬜ `packages/host/product-telemetry-otel`
- ⬜ `packages/interaction/tool-ask-user`
- ⬜ `packages/lsp/lsp`
- ⬜ `packages/lsp/lsp-stdio`
- ⬜ `packages/lsp/tool-lsp`
- ⬜ `packages/preset/persona`
- ⬜ `packages/sdk/client`
- ⬜ `packages/sdk/protocol`
- ⬜ `packages/sdk/server`
- ⬜ `packages/session-query/session-log-export`
- ⬜ `packages/session-query/tool-session-query`
- ⬜ `packages/session/session-stats`
- ⬜ `packages/session/session-title-all-prompts-llm`
- ⬜ `packages/session/session-turn-outline`
- ⬜ `packages/shell/tool-bash-persistent`
- ⬜ `packages/shell/tool-pwsh-persistent`
- ⬜ `packages/skill/skill-office`
- ⬜ `packages/skill/tool-workspace-dependencies`
- ⬜ `packages/ssh/fs-ssh`
- ⬜ `packages/ssh/sandbox-ssh`
- ⬜ `packages/ssh/ssh`
- ⬜ `packages/ssh/subprocess-ssh`
- ⬜ `packages/storage/storage-sqlite`
- ⬜ `packages/subagent/subagent-acp`
- ⬜ `packages/subagent/subagent-claude-code`
- ⬜ `packages/subagent/subagent-codex`
- ⬜ `packages/subagent/subagent-dsh-sdk`
- ⬜ `packages/terminal/terminal`
- ⬜ `packages/terminal/terminal-bash`
- ⬜ `packages/terminal/tool-terminal`
- ⬜ `packages/test-support/client-runtime`
- ⬜ `packages/test-support/remote-mock`
- ⬜ `packages/typert/generator`
- ⬜ `packages/util/deque`
- ⬜ `packages/util/native-command`
- ⬜ `packages/util/workspace-path`
- ⬜ `packages/web/web-search-perplexity`
- ⬜ `packages/webhook/webhook`
- ⬜ `packages/webhook/webhook-github`

## 范围文档显式排除（不迁移，见 scope §4）

- 🚫 `apps/desktop`
- 🚫 `apps/desktop-host`
- 🚫 `apps/web`
- 🚫 `packages/bundle/web-app`
- 🚫 `packages/client/connection`
- 🚫 `packages/client/file-upload`
- 🚫 `packages/client/hmr`
- 🚫 `packages/client/locale`
- 🚫 `packages/client/modules`
- 🚫 `packages/client/resources`
- 🚫 `packages/client/shortcuts`
- 🚫 `packages/client/store`
- 🚫 `packages/client/ui-agent-preset`
- 🚫 `packages/client/ui-approval`
- 🚫 `packages/client/ui-attachment`
- 🚫 `packages/client/ui-brand-official`
- 🚫 `packages/client/ui-chat`
- 🚫 `packages/client/ui-commands`
- 🚫 `packages/client/ui-conversation`
- 🚫 `packages/client/ui-deliverables`
- 🚫 `packages/client/ui-directory-picker-browse`
- 🚫 `packages/client/ui-directory-picker-native`
- 🚫 `packages/client/ui-dockkit`
- 🚫 `packages/client/ui-goal`
- 🚫 `packages/client/ui-input-trigger`
- 🚫 `packages/client/ui-jobs`
- 🚫 `packages/client/ui-layout`
- 🚫 `packages/client/ui-message-feedback`
- 🚫 `packages/client/ui-model-selection`
- 🚫 `packages/client/ui-open-in-app`
- 🚫 `packages/client/ui-permission-presets`
- 🚫 `packages/client/ui-plan`
- 🚫 `packages/client/ui-plugin-manager`
- 🚫 `packages/client/ui-primitives`
- 🚫 `packages/client/ui-reference`
- 🚫 `packages/client/ui-renderer`
- 🚫 `packages/client/ui-schedule`
- 🚫 `packages/client/ui-session`
- 🚫 `packages/client/ui-settings`
- 🚫 `packages/client/ui-settings-account`
- 🚫 `packages/client/ui-settings-agent-loop`
- 🚫 `packages/client/ui-settings-general`
- 🚫 `packages/client/ui-settings-models`
- 🚫 `packages/client/ui-settings-plugin-analyzer`
- 🚫 `packages/client/ui-settings-plugin-inventory`
- 🚫 `packages/client/ui-settings-plugins`
- 🚫 `packages/client/ui-settings-shell`
- 🚫 `packages/client/ui-settings-subagent`
- 🚫 `packages/client/ui-settings-web-search`
- 🚫 `packages/client/ui-shortcuts`
- 🚫 `packages/client/ui-sidebar`
- 🚫 `packages/client/ui-sidebar-browser`
- 🚫 `packages/client/ui-sidebar-documentpreview`
- 🚫 `packages/client/ui-sidebar-files`
- 🚫 `packages/client/ui-sidebar-right`
- 🚫 `packages/client/ui-sidebar-terminal`
- 🚫 `packages/client/ui-skill`
- 🚫 `packages/client/ui-slots`
- 🚫 `packages/client/ui-subagent`
- 🚫 `packages/client/ui-theme`
- 🚫 `packages/client/ui-tool`
- 🚫 `packages/client/ui-trajectory`
- 🚫 `packages/client/ui-user-questions`
- 🚫 `packages/client/ui-workflow-run`
- 🚫 `packages/client/ui-workspace`
- 🚫 `packages/client/web`
- 🚫 `packages/extensions/cordis-client-runner`

## 已迁移包的清单差异（随迁移回填）

## apps/cli

- ✂️ dependencies: `@deepseek-ai/dsh-acp-app`
- ✂️ dependencies: `@deepseek-ai/dsh-agent-tool-presentation`
- ✂️ dependencies: `@deepseek-ai/dsh-client-ui-agent-preset`
- ✂️ dependencies: `@deepseek-ai/dsh-client-ui-cordis`
- ✂️ dependencies: `@deepseek-ai/dsh-cordis-client-runner`
- ✂️ dependencies: `@deepseek-ai/dsh-experimental-agent-team-profile`
- ✂️ dependencies: `@deepseek-ai/dsh-hooks-claude-code`
- ✂️ dependencies: `@deepseek-ai/dsh-hooks-codex`
- ✂️ dependencies: `@deepseek-ai/dsh-persona`
- ✂️ dependencies: `@deepseek-ai/dsh-sdk-app`
- ✂️ dependencies: `@deepseek-ai/dsh-sdk-minimal`
- ✂️ dependencies: `@deepseek-ai/dsh-session-reference`
- ✂️ dependencies: `@deepseek-ai/dsh-skill-office`
- ✂️ dependencies: `@deepseek-ai/dsh-tool-workspace-dependencies`
- ✂️ dependencies: `@deepseek-ai/dsh-terminal`
- ✂️ dependencies: `@deepseek-ai/dsh-terminal-bash`
- ✂️ dependencies: `@deepseek-ai/dsh-time-context`
- ✂️ dependencies: `@deepseek-ai/dsh-tmux-context`
- ✂️ dependencies: `@deepseek-ai/dsh-tool-ask-user`
- ✂️ dependencies: `@deepseek-ai/dsh-tool-bash-persistent`
- ✂️ dependencies: `@deepseek-ai/dsh-tool-cordis`
- ✂️ dependencies: `@deepseek-ai/dsh-tool-pwsh-persistent`
- ✂️ dependencies: `@deepseek-ai/dsh-tool-str-replace-editor`
- ✂️ dependencies: `@deepseek-ai/dsh-web-app`
- ✂️ dependencies: `@deepseek-ai/dsh-webhook`
- ✂️ dependencies: `@deepseek-ai/dsh-webhook-github`
- ✂️ dependencies: `@deepseek-ai/dsh-experimental-voice-input-bundle`
- ✂️ dependencies: `@deepseek-ai/dsh-experimental-auto-review`
- ✂️ devDependencies: `@deepseek-ai/dsh-acp`
- ✂️ devDependencies: `@deepseek-ai/dsh-experimental-agent-team`
- ✂️ devDependencies: `@deepseek-ai/dsh-experimental-ptc-runtime-python`
- ✂️ devDependencies: `@deepseek-ai/dsh-experimental-tool-agent-team`
- ✂️ devDependencies: `@deepseek-ai/dsh-host-frontend-static`
- ✂️ devDependencies: `@deepseek-ai/dsh-plugin-doctor`
- ✂️ devDependencies: `@deepseek-ai/dsh-sdk-client`
- ✂️ references 修剪: `packages/bundle/web-app`
- ✂️ references 修剪: `packages/host/frontend-static`
- ✂️ references 新增: `packages/util/http-proxy`

## packages/bundle/base

- ✂️ dependencies: `@deepseek-ai/dsh-api-gateway`

## packages/bundle/headless

- ✂️ references 新增: `packages/util/brand`
- ✂️ references 新增: `packages/util/values`

## packages/compaction/compaction

- ✂️ references 新增: `packages/attachment/attachment`

## packages/core/agent

- ✂️ references 新增: `packages/util/values`

## packages/core/agent-loop

- ✂️ references 新增: `packages/util/values`
- ✂️ references 新增: `packages/util/brand`

## packages/core/tools

- ✂️ references 新增: `vendor/schemastery`
- ✂️ references 新增: `packages/util/values`
- ✂️ references 新增: `packages/util/brand`

## packages/llm/llm

- ✂️ references 新增: `vendor/schemastery`

## packages/llm/llm-deepseek

- ✂️ references 新增: `packages/util/values`

## packages/sandbox/sandbox

- ✂️ references 新增: `packages/util/values`

## packages/schedule/schedule

- ✂️ devDependencies: `@deepseek-ai/dsh-api-session-controller`
- ✂️ peerDependencies: `@deepseek-ai/dsh-api-session-controller`
- ✂️ references 修剪: `packages/api/session-controller/tsconfig.host.json`

## packages/session/session-persistence

- ✂️ references 新增: `packages/util/values`

## packages/session/session-projection-cache

- ✂️ references 新增: `packages/util/values`

## packages/session/session-title

- ✂️ references 新增: `packages/util/values`

## packages/settings/settings

- ✂️ references 新增: `packages/boot/app-boot`

## packages/shell/shell

- ✂️ references 新增: `packages/attachment/attachment`

## packages/todo/tool-todo

- ✂️ references 新增: `vendor/schemastery`
