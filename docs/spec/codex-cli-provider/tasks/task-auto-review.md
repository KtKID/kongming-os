---
description: 将 KMH 的帮我审批接到 Codex 官方自动审查，并验证权限映射与审批选项。
---

# 让 Codex 自动审查额外权限请求

> spec: docs/spec/codex-cli-provider/spec.md
> feat: feat09
> 创建: 2026-10-11

## ① 需求

### 功能方向

- R1：选择帮我审批后，Codex 自动审查需要额外权限的原生操作，通过后执行，拒绝后返回结果。
- R2：用户能区分自动审查、询问用户与关闭询问，并查看当前官方程序支持的审批选项。
- R3：更新后的日常 Web 正常提供 Codex 与会话服务，恢复过程沿用原数据目录与端口并关闭浏览器交接。

### 功能边界

本次调整 KMH 的 Codex 插件权限映射、对应测试、权限选项说明与 Codex 文档。KMH 工具继续遵循宿主权限策略，其他模型提供方保持各自的映射。

### 不能破坏的不变量

- I1：请求审批继续由用户决定；完全权限继续使用完整访问范围；仅可查看保持只读。
- I2：已有会话数据与权限选择保持兼容，进行中的回合沿用启动时的设置。
- I3：验证使用本地模拟服务与官方程序，测试保持无浏览器交接；运行数据、端口与其他插件配置保持原值。

## ② 测试用例（先写，此刻失败）

### unit

- U1：既有审批桥用例覆盖批准、拒绝、取消、缺少入口与权限范围限制 → I1、I2。

### smoke

- S1：真实 Codex CLI 启动检查覆盖帮我审批、请求审批、完全权限、仅可查看与关闭原生执行工具；检查 `-c` 参数及官方运行配置 → R1、I1、I2、I3。
- S2：当前官方 CLI 帮助和生成协议列出审批策略、审批人及预设入口；验证 `never` 对额外权限请求的限制 → R2、I3。
- E1：真实 Web 使用 `--no-open` 启动，检查完整运行期间的浏览器交接记录、同进程 HMR 与服务回收；日常 3080 的插件服务异常后恢复并检查鉴权页面与 API → R3、I3。

## ③ 技术实现

### 实现步骤

1. 更新启动用例，要求帮我审批生成工作区沙箱、按需申请和自动审查参数，先确认旧实现失败。
2. 在已有权限旋钮映射中识别工作区免人工询问档，将其映射到 Codex 官方自动审查；请求审批显式选择用户审查。
3. 更新权限说明、包 README 与 feat09 的当前语义，保留已有会话事件和 KMH 权限旋钮。
4. 单次构建插件，验证官方 CLI 的实际配置，再运行 Codex 插件相关回归与静态检查。
5. 本次配置重载使日常 Web 的插件失活。Web 配置接收 `webStartup.openBrowser`，恢复服务时 `--no-open` 生效；同步真实启动用例与前一任务的当前说明。

### 涉及文件

- `packages/codex-cli/src/isolation.ts`：自动审查映射。
- `tests/runtime/codex-cli.test.mjs`：真实启动、运行配置与审批回归。
- `profiles/kmh-web/cordis.patch.yml`：帮我审批选项说明。
- `profiles/kmh-web/README.md`：启动选项与浏览器交接。
- `tests/runtime/web-plugin-hmr.test.mjs`：直接验证 `--no-open` 的配置接线与实际交接。
- `packages/codex-cli/README.md`：权限行为。
- `docs/spec/codex-cli-provider/spec.md`、`decisions.md`：feat09 与修订记录。
- `tasks/task-approval-bridge/dev-checklist.md`：首次实现记录链接到当前映射。
- `docs/spec/kmh-plugin-framework-v0.1/tasks/task-manual-plugin-build.md`：链接后续启动配置接线。
- 本任务文档：需求、测试与验证。

## ④ 验证结果

### 失败证据

新增帮我审批断言在旧构建上失败：启动参数缺少 `approval_policy="on-request"`；官方 `config/read` 实际返回 `never`。两个用例均在实现前运行并复现该差异。

```text
node --test --test-name-pattern='allowlist selection opens native capabilities' tests/runtime/codex-cli.test.mjs
ℹ tests 1
ℹ pass 0
ℹ fail 1
assert.ok(autoReviewed.includes('approval_policy="on-request"'))

node --test --test-name-pattern='official CLI reads the mapped approval policy' tests/runtime/codex-cli.test.mjs
ℹ tests 1
ℹ pass 0
ℹ fail 1
actual: 'never'
expected: 'on-request'
```

### 测试输出

```text
node --test --test-name-pattern='allowlist selection opens native capabilities|official CLI reads the mapped approval policy|approval bridge|permissions approval' tests/runtime/codex-cli.test.mjs
ℹ tests 7
ℹ pass 7
ℹ fail 0
ℹ duration_ms 4049.334667

node --test --test-concurrency=1 tests/runtime/codex-cli.test.mjs packages/codex-cli/test/*.test.mjs
ℹ tests 64
ℹ pass 64
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 76865.406875

node --test tests/runtime/web-plugin-hmr.test.mjs tests/runtime/plugin-build.test.mjs
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ duration_ms 8845.212458
```

7 项聚焦检查包含在 64 项 Codex 回归中；加上 2 项 Web 启动检查，共 66 项不同测试通过。测试使用本地 Responses 模拟服务与真实官方 CLI，覆盖权限参数、实际运行配置、审批决定、会话恢复、工具转发、流式输出与停止回收。自动审查模型的具体风险判断遵循官方实现，本次以实际运行配置核对接入。

### 官方选项核对

实际程序为 `codex-cli 0.162.0-alpha.17.2`。顶层 `--help` 列出 `--ask-for-approval` 的两个值 `on-request`、`never`，以及 `--approve-for-me`、`--dangerously-bypass-approvals-and-sandbox` 两个预设入口。分别向 `-a` 传入 `untrusted`、`on-failure`，程序均以状态 2 拒收并列出上述两个支持值。生成的实验协议还提供 `granular` 分类审批配置，以及 `user`、`auto_review` 审批人；`guardian_subagent` 为旧名兼容值。

官方 CLI 通过 `config/read` 确认帮我审批的配置为 `sandbox_mode=workspace-write`、`approval_policy=on-request`、`approvals_reviewer=auto_review`。KMH 的 `never` 自动拒绝宿主审批请求，Codex 的 `never` 关闭审批询问并拒绝需要额外批准的请求；已有沙箱范围内允许的操作可直接执行。范围设置与审批设置独立；完整访问组合为 `danger-full-access + never`。依据：[官方审批人配置](https://developers.openai.com/codex/config-reference)、[官方沙箱与审批说明](https://learn.chatgpt.com/docs/sandboxing?translationFallback=pt-BR)，以及当前程序帮助、生成协议与运行配置。

### 静态检查与构建

```text
pnpm_config_verify_deps_before_run=false pnpm --filter @kmh/codex-cli build
退出状态 0

pnpm_config_verify_deps_before_run=false pnpm --filter @kmh/codex-cli typecheck
退出状态 0

pnpm_config_verify_deps_before_run=false pnpm --filter @kmh/codex-cli lint
退出状态 0

node node_modules/prettier/bin/prettier.cjs packages/codex-cli/src/isolation.ts --check
All matched files use Prettier code style!

git diff --check
退出状态 0
```

### 日常服务恢复

编译期间，权限说明的配置变更也触发 profile 重载。PID 54409 的日志记录 `12 entries did not activate`，随后出现 `loader` 上下文失活、重复注册和存储域重复打开。代码与参数测试通过，日常服务的该次热重载失活仍需单独定位；本次保持 DSH 子模块原样。

Web 配置现接收 `webStartup.openBrowser`。沿用 `/Users/kid/.kmh-dev` 执行一次 `./kmh.sh restart`，恢复固定端口 3080，启动记录确认无浏览器交接；鉴权页面、Codex 配置与状态 API 均返回 200，新进程日志保持无上述插件失活错误。

```json
{"pid":75637,"port":3080,"browserHandoff":false,"pluginFailures":0,"statuses":{"/":200,"/api/codex-cli/config":200,"/api/codex-cli/live":200}}
```

### 自检

feat09 与四段结构齐全，R1/R2/R3 和 I1/I2/I3 均有测试回指；实际改动覆盖所列 11 个 KMH 文件，已有其他工作区修改保持原样。进行中的回合与持久化格式沿用既有行为，服务恢复使用原数据目录与端口。

### 结论

- [x] 所有需求点被测试覆盖
- [x] 所有测试真实跑过且通过
- [x] 实现在边界内
- [x] 不变量未破坏
