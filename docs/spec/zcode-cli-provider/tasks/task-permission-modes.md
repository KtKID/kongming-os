---
description: 将 KMH 会话的权限选择同步到 ZCode 计划模式、变更前确认与完全访问，包含需求、失败测试、实现和验收记录。
---

# ZCode 跟随 KMH 的权限选择

> spec: docs/spec/zcode-cli-provider/spec.md
> feat: feat01
> 创建: 2026-10-11

## ① 需求

### 功能方向

- R1：选择“仅可查看”后，ZCode 使用计划模式；选择“请求审批”后，ZCode 使用变更前确认；选择“完全权限”后，ZCode 使用完全访问。
- R2：已有会话、后续消息和重新连接后的会话继续使用当前权限选择。进行中切换影响后续工具决策；已开始的操作按 ZCode 自身执行语义完成。
- R3：完全权限下，已授权会话的工具请求直接获得授权；请求审批下按用户的允许或拒绝处理；仅可查看下保持查看范围。

### 功能边界

本次修改 ZCode 插件的权限模式与审批适配，更新包说明和 B3 修复记录。现有“帮我审批”档沿用自动编辑范围；独立安装缺少宿主会话或权限服务时使用变更前确认。未知权限预设在发送前明确报错。工具桥接入 B1、CUA 运行时可用性和其他提供方由各自任务维护。

### 不能破坏的不变量

- I1：同一个 KMH 会话持续复用同一个 ZCode 会话，后续只发送新增内容。
- I2：审批服务的确定性拒绝语义和其他提供方保持原有行为。
- I3：权限切换与进程回收遵守已有停止、超时和资源清理机制。
- I4：缺失会话身份或授权上下文时采用保守行为，未知权限值明确失败。

## ② 测试用例（先写，此刻失败）

### unit

- U1：只读、请求审批、完全权限和现有自动编辑档映射为官方模式；空值和未知值报错 → R1、I4。
- U2：完全权限回调直接允许、计划模式残余审批拒绝、请求审批允许/拒绝分别回传；上下文缺失继续拒绝 → R3、I2、I4。

### smoke

- S1：真实宿主子进程调用 fixture CLI，核对三档创建参数、同会话切档、增量发送和恢复后的模式设置 → R1、R2、I1。
- S2：在途回合切档同步；模式设置失败、错误回执和计划开关缺失时阻止发送；未知会话预设在创建前报错 → R2、I3、I4。
- S3：真实审批服务 policy=never 与插件组合，完全权限调用获得授权，切回请求审批后再次询问 → R3、I2。

### e2e

E1：按本机已安装 CLI 的真实协议核对创建、模式变更与恢复结果，使用隔离会话数据；正常 KMH Web 模型驱动的完整截屏验收随 B1/B2 工具桥任务推进 → R1、R2、I1。

## ③ 技术实现

### 实现步骤

1. 读取当前宿主会话的权限预设，映射 `read-only → plan`、`workspace-write → build`、`danger-full-access → yolo`；现有 `workspace-write-auto → edit`。缺少会话或权限服务时使用 `build`，未知预设报 `ZCODE_PERMISSION_MODE_UNSUPPORTED`。
2. 创建携带目标模式，并读取实际回执；CLI 返回默认权限时使用 `session/setMode` 校正。恢复后重新设置权限，正常续用保留同一会话和增量输入。
3. 监听权限选择事件，同一连接内串行执行模式更新；每次发送等待模式确认。设置错误或回执不符时停止该次发送。CLI 自身发布的模式变更使缓存失效，后续发送重新对齐宿主选择。
4. 原生验证发现 CLI 0.16.9 将计划模式保存为基础权限加 `planEnabled`。`plan` 会保留之前的基础权限；适配进入计划模式时先设置 `build`，再设置 `plan`，核对 `session.updated` 的 `mode=build` 和 `planEnabled=true`。`build/edit/yolo` 会关闭计划开关。
5. 反向工具审批每次读取当前会话授权：完全权限直接允许，计划模式拒绝残余审批，请求审批经原有审批服务处理。所有授权回调仍要求已绑定的活跃 Agent，DSH `never` 的拒绝语义维持原有行为。

### 涉及文件

- `packages/zcode-cli/src/permission.ts`：预设映射、保守解析与原生回执/执行状态的 Zod 定义。
- `packages/zcode-cli/src/session.ts`：创建回执校正、恢复和进行中模式同步、发送前确认。
- `packages/zcode-cli/src/interaction.ts`：按当前会话预设处理反向审批。
- `packages/zcode-cli/package.json`、`pnpm-lock.yaml`：声明宿主权限服务的类型依赖。
- `tests/runtime/zcode-cli-session.test.mjs`：14 项新增权限行为测试，与原有生命周期测试共同回归。
- `tests/runtime/fixtures/zcode-cli/cli.mjs`：官方权限与计划开关分开表示的协议 fixture，以及失败回执场景。
- `tests/runtime/fixtures/zcode-cli/permission-modes.expected.json`：四次真实中继调用的 CLI 决策与真实审批服务审计快照。
- `packages/zcode-cli/README.md`：用户档位、原生状态与故障行为说明。
- 本任务文档：需求、失败证据、实现和验收。
- `reports/cr/cr-report-20261011-103703-zcode-kmh-tools.md`：B3 修复记录；B1/B2 工具桥验收继续待处理。

## ④ 验证结果

### 先失败，再实现

先新增三档创建、切换和恢复测试，运行旧构建得到 5 项行为失败；随后加入真实审批服务组合测试，复现完全权限得到 `deny`。实际输出摘要：

```text
node --test --test-name-pattern='permissions (create|switching|resume)' tests/runtime/zcode-cli-session.test.mjs
ℹ tests 5
ℹ pass 0
ℹ fail 5
创建回执断言：undefined !== plan/build/yolo
切换/恢复断言：ENOENT session-modes.jsonl

node --test --test-name-pattern='permissions callbacks' tests/runtime/zcode-cli-session.test.mjs
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError: 'deny' !== 'allow'
```

### 权限测试与不变量回归

```text
node --test --test-concurrency=1 tests/runtime/zcode-cli-session.test.mjs tests/runtime/zcode-cli.test.mjs
ℹ tests 83
ℹ suites 0
ℹ pass 83
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 27973.051166
```

83 项包含新增权限测试 14 项，以及既有回归 69 项。U1 对应映射与未知值 2 项，U2 对应缺失 Agent 1 项；S1 对应三档创建、默认权限校正、同会话切换和恢复 6 项；S2 对应在途切换、设置失败、错误回执与计划确认缺失 4 项；S3 对应真实审批服务与审计快照 1 项。原有用量、会话复用、并发、增量输入、停止、空闲回收、CLI 崩溃、账号与代理继承的回归全部通过。

### 原生 CLI 协议验证

使用 `/Users/kid/.local/bin/zcode app-server` 和隔离的工作目录、会话存储、日志目录；导入一条测试文本使会话持久化。调用创建、订阅、`session/setMode`，重启测试子进程后恢复同一会话并重新应用档位，整个验证没有 `session/send`。原生输出摘要：

```text
{"requested":"plan","applied":{"mode":"build","planEnabled":true}}
{"requested":"yolo","applied":{"mode":"yolo","planEnabled":false}}
{"requested":"build","applied":{"mode":"build","planEnabled":false}}
{"resumedSameSession":true,"requested":"plan"}
{"resumedSameSession":true,"requested":"build"}
{"resumedSameSession":true,"requested":"yolo"}
PASS 15 applied mode checks; 3 cross-process resumes; no model sends
```

三档创建均成功，15 次状态断言与 3 次跨进程恢复通过，隔离数据和进程已清理。首次探测因缺少显式 builtin 配置退出，补齐测试启动参数后，沙箱在 CLI 启动阶段返回 `EPERM`；使用相同隔离测试命令在宿主执行完成验证。初始将 `session.mode` 当作计划模式值的断言失败，官方源码与实际 `session.updated` 共同确认计划开关分离；fixture 随真实协议修正，最终适配检查基础权限与计划事件。

### 构建与静态检查

`build`、`typecheck`、`lint`、`format:check` 均通过。安装器的默认运行前检查尝试重建既有依赖目录并因缺少 TTY 中止；通过 `pnpm_config_verify_deps_before_run=false` 使用既有依赖完成以下检查，新依赖为当前 DSH 子模块的本地链接，清单与锁文件已对齐。

```text
pnpm_config_verify_deps_before_run=false pnpm --dir packages/zcode-cli run build
$ node build.mjs
exit 0
pnpm_config_verify_deps_before_run=false pnpm --dir packages/zcode-cli run typecheck
$ tsc -p tsconfig.host.json --noEmit && tsc -p tsconfig.browser.json --noEmit
exit 0
pnpm_config_verify_deps_before_run=false pnpm --dir packages/zcode-cli run lint
$ eslint src --max-warnings 0
exit 0
pnpm_config_verify_deps_before_run=false pnpm --dir packages/zcode-cli run format:check
Checking formatting...
All matched files use Prettier code style!
```

### 验收范围

本次交付权限映射与切档适配，11 个相关文件。代码和构建产物已更新；现有 KMH dev Host 需重启加载插件。正常 Web 模型驱动的 KMH CUA 截屏、工具前缀和工具回调属于 B1/B2，仍待后续实现与验收。

### 结论

- [x] 所有需求点被测试覆盖
- [x] 所有测试真实跑过且通过
- [x] 实现在边界内
- [x] 不变量未破坏
