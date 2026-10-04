# KMH：DSH 基础框架源码迁移交付报告（2026-10-02）

当前工作区已于 2026-10-03 上移到仓库根，现行入口见 [KMH 工作区](../kmh/README.md)。下文带日期的验证记录保留当时的命令；当前命令从根目录执行 `pnpm`。

执行 [kmh-dsh-framework-cli-scope.md](./kmh-dsh-framework-cli-scope.md) 定义的源码迁移第一轮：
把 DSH 的 Cordis 插件底座、boot 启动链和 CLI 源码迁入 KMH 工作区（`packages/`），
替换此前基于官方 npm Cordis 的独立 TS 重写。

- 参考源码：`/Volumes/machub_app/proj/agent/deepseek-harness`
- 基线提交：`85805356f6b5fbc55d06ea129fc4e98e4b903ed3`（迁移时即该仓库 HEAD，含 vendor 全部 22 条本地加固）
- 迁移方式：目录级复制（`src/` + 预构建 `lib/` + `package.json` + `tsconfig.json` + LICENSE/README），
  排除 `node_modules` 与 `*.tsbuildinfo`

## 1. 迁移清单（20 包 + 根工程文件）

| 分组 | 包 | 说明 |
|---|---|---|
| vendor（9） | cordis、cosmokit、schemastery、loader、include、group、timer、logger-console、hmr | `@deepseek-ai/*` scope 原样保留，含 DSH fiber 生命周期加固、applyEntryPatches 导出、懒求值、volatile 等 22 条本地修改 |
| packages/util（6） | home-paths、launch-environment、package-manifest、atomic-write、values、http-proxy | scope 文档优先核对五件套 + plugin-manager 运行时依赖 values |
| packages/boot（4） | app-boot、cmdline、plugin-manager、hmr | profile/bundle/patch 分层装配、命令行参数服务、插件包管理、源码/配置重载 |
| apps/cli（1） | @deepseek-ai/dsh | CLI 源码入口 + tests/ + sdk-source.cordis.patch.yml |
| 根工程 | tsconfig.base.json（paths 裁剪到闭包 23 条）、tsconfig.json（solution 文件）、package.json、pnpm-workspace.yaml、.gitignore、README.md | 见 §3 决策 |

## 2. 布局

沿用 DSH 布局（`vendor/*` + `packages/<能力组>/<包>` + `apps/*`），KMH workspace 根为 `kongming-agent/`。工作区整体上移使包内 `extends`/`references` 相对关系保持原值。旧 KMH v0.2 扁平工作区位于根 `legacy/`，已排除出 pnpm workspace；说明见 [legacy/README.md](../../legacy/README.md)。

## 3. 关键决策

1. **保留 `@deepseek-ai` scope**：与 DSH vendor manifest 1:1 溯源，后续同步零重命名成本。
   `pnpm-workspace.yaml` 沿用 DSH 的 overrides（cosmokit/schemastery 强制 link 到 vendor），
   保证"统一框架实例"。
2. **预构建 `lib/` 随源迁入**：DSH 开发模型是 tsx 源码启动 + 根 tsconfig paths 把
   `@deepseek-ai/*` 解析到各包 `src/`（`FiberState` 等 `const enum` 仅源码形态存在），
   同时 exports 消费预构建 `lib/`。两者都保留，行为与 DSH 开发环境一致。
3. **根 tsconfig.json 采用 DSH solution-file 形态**：`extends` 携带 paths（供 tsx）、
   `files: []` 保持 program-less、`references` 是类型检查集合。
4. **依赖修剪（唯一源码改动见第 5 点）**：apps/cli `dependencies` 从 70+ 收敛到
   src import 闭包（9 个 workspace 包 + commander/js-yaml/node-addon-require-builtin）；
   各包 `devDependencies`/`peerDependencies`/tsconfig `references` 删除指向未迁移包的
   条目。修剪的是打包运行时依赖声明，不影响 boot 链。
5. **app-boot 1 行修剪**：删除 `import type {} from '@deepseek-ai/dsh-system-prompt'`
   （纯类型导入；system-prompt 的 src 依赖 dsh-scope/dsh-llm，属后端轮范围，试迁后
   回退），原位置留注释标记恢复点。
6. **类型检查集合 = 19 包**（vendor 9 + util 6 + boot/{app-boot,cmdline,hmr}）；
   `packages/boot/plugin-manager` 与 `apps/cli` 暂不在集合（原因见 §5 缺口）。

## 4. 验证证据

- `pnpm install`：21 个 workspace 项目 + 58 个外部包，全部解析安装成功
  （cordis↔include 循环 peer 警告与 DSH 原生一致，无害）。
- `tsc -b tsconfig.json`：19 包集合零错误。
- CLI 冒烟（`node --import tsx/esm apps/cli/src/bin.ts`，`DSH_HOME=/tmp/kmh-dsh-home`）：
  - `--help`：完整命令帮助输出 ✓
  - `--profile min --dump-config`：profile manifest 读取 → 补丁层组合 → 绝对路径
    锚定为 `file://` URL → include 条目规范化，全链输出正确 ✓
  - `--profile min` 真实挂载：timer + logger-console（经 cosmokit/schemastery 依赖链）
    激活成功，干净退出 `exit=0` ✓
  - 可写条目表：`cordis.yml` 缺省时由 include 初始化为空数组 + 官方注释 ✓
    （vendor #14 缺省文件初始化路径）
  - fail-loud 启动诊断：构造 group 条目缺 `config` 的坏 profile，启动报告
    "1 entry did not activate" + 精确堆栈 ✓（timer 不受影响照常激活）
- 行为对照：`--version` 无 `--profile` 时报错，与 DSH 原仓库行为一致（上游语义）。

## 5. 测试结果（2026-10-02 最终轮）

框架部分测试套件（`pnpm --dir packages exec vitest run`，精简配置见
`packages/vitest.config.ts`，复刻 DSH 的 paths 解析门面 + 装饰器转译）：

- **31/31 测试文件通过，5719 用例通过，0 失败**（1 个 skip 来自上游用例自身的平台条件）；
- 覆盖：app-boot 19 spec（分层装配、补丁组合、配置回写、schema 投影、profile 解析）、
  boot/cmdline、boot/hmr 5 spec、util 全部 6 spec；vendor 无自带测试（与 DSH 一致，
  vendored 包的回归覆盖在消费方测试中）。
- 三处排除（`vitest.config.ts` 注释登记恢复条件）：
  1. plugin-manager 10 spec——import 未迁移后端包（dsh-subprocess/dsh-tools/dsh-llm 等）；
  2. app-boot.spec——import dsh-system-prompt（其 src 依赖 dsh-scope/dsh-llm）；
  3. hmr watch-config.spec——外置卷 chokidar 原生事件不可达，**DSH 原仓库同环境
     逐用例同样失败（3 failed / 13 passed 完全一致）**，属环境限制而非迁移差异，
     正常文件系统上运行时移除排除。

## 6. 已知缺口（后续轮次；状态随 §7 增量推进，最新以台账为准）

> 本节写于第一轮交付（20 包阶段），下带 ✅/⏳ 标记为第 6 步（base 闭环）后的现状。

1. ⏳ **后端包**：scope §2 全集截至第 6 步已迁 166/329（`bundle/base` 已落地，
   `api/gateway` 因 src 硬引用范围排除的 client-connection 延期到 web 轮）；剩余
   待迁 96 包集中在 api/host 客户端栈、experimental、terminal、ssh、hooks 等，
   逐组见 [台账](./kmh-dsh-baseline-delta.md)。plugin-manager 与 apps/cli 已随第 6 步补齐
   类型依赖链并回归检查集合（tsc 全绿）；plugin-manager 的 manager.spec 仍有
   4 个用例依赖 apps/desktop 内置 pnpm（见第 6 步记录），属测试载体缺口。
2. ✅ **system-prompt**（第 3 步迁入，e93b373a 恢复 app-boot 类型导入）。
3. ⏳ **测试体系**：根 vitest 配置 + setupFiles 三件套 + patches + 语料已随第 6 步
   迁入；DSH 分区/覆盖率/目录生成器（gen-* 用例）仍依赖根 scripts/ 体系。
4. ⏳ **scripts/**：测试侧已按需补入（test-* setup、snapshot-workspace-parent、
   snapshots 语料）；构建编排（build.ts）、rescale-vendor 等仍未迁。
5. ✅ **native/system**：第 6 步随 session-persistence-jsonl 整体迁入
   （darwin-arm64 预构建实测工作，v4 会话 zstd 落盘）。
6. ⏳ **旧 KMH 处置**：`legacy/` 暂存；其 v0.2 的 50 场景语义验收（evidence.json）是
   后续把 DSH boot 链对照 KMH 语义需求的参照基线，全部对照完成后再决定删除。

## 7. 增量迁移执行日志

按"自底向上、每步可感知、每步一提交"的路线执行（与 §6 缺口清单互为推进）。

### 第 1 步：LLM 调用链（2026-10-02）

- 迁入 9 包：`llm/llm`、`llm/llm-deepseek`、`llm/deepseek-llm-api-extensions`、
  `util/brand`、`util/crypto`、`util/timeout`、`typert/protocol`、`attachment/attachment`、
  `runtime-diagnostics/invariants`。
- 类型检查集合扩至 26 包零错误；`llm-deepseek` 暂列集合外（`src/host.ts` 依赖未迁的
  dsh-settings / dsh-fs / dsh-anonymous-user-id，随宿主能力轮恢复），其 12 个测试同步
  排除；llm 的属性测试补 root devDep `fast-check` 后纳入。
- 测试：54 文件 / 6116 用例全绿（0 失败）。
- 感知验证：min profile 挂 `llm` + 自写 echo 适配器演示插件（
  `tmp/kmh-dsh-home/profiles/min/demo-llm.mjs`），走完
  registerAdapter → prepareCall → stream → text-delta 组装全链并打印回答后干净退出
  （`exit=0`），无需 API key；接真模型时改挂 `llm-deepseek` 并配 connection 即可。

### 第 2 步：会话日志（2026-10-02）

- 迁入 3 包：`core/session`（SessionStore，`ctx.sessions` 服务）、`core/scope`、
  `typert/registry`（后两者为 session 测试依赖，闭包零新增外部依赖）。
- 类型检查集合扩至 29 包零错误；测试 6691 用例全绿（新增 575）。
- 感知验证：demo 插件 inject `sessions` 后创建会话并打印
  （`会话已创建: session-1`），展示依赖驱动等待→就绪→服务可用的完整链路。
  会话的写面（事件追加）由第 4 步 agent loop 作为主要写者接入。

### 第 3 步：工具底座（2026-10-03）

- 实际迁入 24 包（src 级依赖链比预估多，逐层补齐）：
  - 核心：`core/tools`（工具注册/调度）、`subprocess/subprocess` + `subprocess-local`
    （进程服务与本地实现，node-pty 含 DSH patch）、`shell/{shell,shell-env,bash-local,tool-bash}`
    （shell 抽象、环境、本地执行器、bash 工具）、`fs/{fs,fs-local}`、`core/system-prompt`（提前）；
  - tools 的 src 依赖链：`sandbox/{sandbox-policy,sandbox}`、`interaction/user-approval`、
    `ptc-runtime/ptc-runtime`、`core/agent`（原第 4 步主体，被 tools 硬依赖提前迁入）、
    `jobs/jobs`、`workspace/workspace` + `storage/{storage,storage-domain}` +
    `session/{session-persistence,session-projection}`（agent 归档/投影的类型链）、
    `util/{lazy-require,win32-process}`、`test-support/loader-smoke`。
- 门禁：类型检查 50 包零错误；测试 137 文件 / 7886 用例全绿。
- 工程修复：`tsc --force` 写到 src 旁的产物与 .ts 并存会让 Vite 把同包解析成两种模块
  形态（symbol/scope 表分裂，scoped dispatch 行为漂移）——新增
  `scripts/clean-src-artifacts.mjs`（对照 DSH 基线删除本地产物）挂进 `pnpm typecheck`；
  发现并修复"抽象定义包当插件挂载"的用法错误（shell/fs 只挂实现包 bash-local/fs-local）。
- 感知验证：min profile 全链挂载（llm + session + subprocess-local + bash-local +
  shell-env + system-prompt + tools + tool-bash + fs-local），demo 调
  `ctx.tools.execute(bash)` 真实执行 `echo + date`，返回真实 stdout、exitCode 0、
  超时控制字段齐全。

### 第 4 步：agent loop（2026-10-03）

- 迁入 1 包：`core/agent-loop`（`ctx.agentLoop` 服务，AgentFactory：createAgent /
  resume，驱动 LLM↔工具循环到静默）。`core/agent` 主体已在第 3 步因 tools 硬依赖提前迁入。
- 门禁：类型检查 51 包零错误；测试 155 文件 / 8222 用例全绿（agent-loop 的 336 个
  循环行为用例——turn 调度、请求冻结、并发回收等——全部通过；7 个依赖未迁 testkit
  的 spec 登记排除）。
- 工程修复：vitest 显式锁定 `root`（否则收集范围溢出 packages/，扫到 kongming-agent
  仓库根的 web 前端与 .pnpm-store 缓存）。
- 感知验证：min profile 挂 `agent` + `session-projection` + `agent-loop`，
  `agentLoop` 服务经依赖注入就绪（demo 打印 `agentLoop 服务在线: true`），
  bash 工具与 LLM 调用链照常。完整"一条任务跑到底"的循环演示由第 5 步 headless
  组装承接（官方的循环驱动用例）。

### 第 5 步：headless 开箱组装（2026-10-03）

- 迁入 16 包：`bundle/headless`（startup + runner）、`core/agent-default-model`、
  `boot/config-editor`、`settings/settings`、`session-query/session-query`、
  `session/session-title`、`session/session-format-catalog` + `session-format` + 4 个
  v0→v4 升级器、`session/session-projection-cache`、`compaction/compaction`、
  `compaction/compaction-image-offload`、`interaction/commands`、`todo/tool-todo`。
- 门禁：类型检查 **68 包零错误**（`--force` 全量重编验证）；测试 158 文件 /
  8286 用例全绿。
- 感知验证（`tmp/kmh-dsh-home/profiles/task/`，KMH 精简 headless profile）：

  ```sh
  DSH_HOME=$PWD/tmp/kmh-dsh-home pnpm --dir packages dsh task "检查这个目录并总结"
  → [echo 模型] 任务已受理并完成一轮推理: 检查这个目录并总结   （exit=0）
  ```

  一条命令走完：CLI 位置参数 → cmdlineArgs 服务 → headless-startup 解析任务 →
  runner 建会话/agent → agent-loop 驱动 → agent-default-model（echo provider 路由）→
  LLM 适配器流式回答 → 结果打印 → 干净退出。runner 的 `!!js` config 求值
  （vendor 修改 #15）在真实启动中工作。接真模型时把 `agent-default-model` 的
  config 换成真 provider + 挂对应适配器即可。

### 第 6 步：base 闭环（2026-10-03）

目标：官方 `bundle/base` 的 93 个装配行全量落地（`typert-gateway` 一行除外），
让 `dsh task` 以真模型跑通"LLM 发起工具调用 → 执行 → 结果回喂 → 回答"的完整循环，
且会话以 v4+zstd 格式持久落盘（native/system 原生库首次实际工作）。

- 迁入规模（台账口径 77 → **166 / 329**）：
  - 初批 71 包：由 base 依赖区 + patch 装配名做 dependencies-only BFS 求闭包——
    持久化后端（session-persistence-jsonl、storage-json、session-query-sqlite）、
    fs 工具面（tool-fs、tool-fs-search、fs-sandbox、fs-observation-policy）、
    skill 4 包、subagent 5 包、goal 4 包、web 工具 4 包、workflow 3 包、
    compaction 补齐 3 包、spill、guard、credentials 3 包、llm 扩展 5 包、
    jobs-local/tool-jobs、plan-mode、mcp-resources、ptc-runtime-node、
    sandbox-local/windows-acl、pwsh 链、test-support 4 件（testkit/mock-server/replay/snapshot）
    与 `bundle/base` 本体；
  - native/system 子工作区整体迁入（entry + 4 平台预构建包 + workspace 容器；
    根 workspace 增 `native/system`、`native/system/packages/*` glob）；
  - src 级补迁 13 包（见下方 import 错误记录 R1）；
  - 测试依赖补迁 5 包（context/file-reference{,-local}、mcp/mcp-client、
    schedule/schedule、preset/agent-preset）+ web/web-search-exa。
- **门禁**：类型检查全绿（仅 `schedule` 一项登记集合外，见 R3；plugin-manager 与
  apps/cli 的类型依赖链已随本轮补齐并回归集合，tsc 全绿）；vitest **590 文件 / 18833 用例全绿**
  （include 收敛为单一 glob `packages/*/*/tests/**/*.spec.ts`，按 packages/ 只含已迁包
  的不变式自动扩面）；台账 src 差异 0、清单修剪 253 → 49 条。
- 感知验证（`tmp/kmh-dsh-home/profiles/task/`，minimax 真模型 + tool-fs + 持久化）：

  ```sh
  DSH_HOME=$PWD/tmp/kmh-dsh-home pnpm dsh:mm task \
    "读取仓库根目录的 package.json，告诉我 name 字段的值，只回答这个值"
  → `@kmh/workspace`   （模型先发起 read 工具调用，读取后作答；exit=0）
  ```

  落盘核验：`sessions/<workspace>/session-*/session.v4.jsonl.zstd` 内完整记录
  `user/message → assistant reasoning → tool/call(read package.json) → tool/result
  → assistant/message(答案) → turn/end` 全事件链；`storages/` 由 storage-json
  初始化（session_projcache 域）。skill 目录装载可见（模型 reasoning 提及 catalog）。

#### 第 6 步工程修复与配置发现（迁移过程记录）

1. **pnpm patchedDependencies 未随迁**：`@earendil-works/pi-ai` 补丁缺失导致
   llm-pi-ai 流式工具参数解析行为漂移（2 用例红）；已迁 `patches/` 全量文件，
   `patchedDependencies` 先登记当前依赖图内的 pi-ai 与 node-pty 两条，其余补丁
   文件就位、随对应包迁入再登记（pnpm 拒绝图外条目）。
2. **根 tsconfig paths 子路径键缺失**：DSH 根 507 条（含逐子路径键与 7 条通配），
   KMH 生成版仅 206 条精确名——子路径 import（如 `dsh-tool-subagent/model-selection-settings`）
   落到 node 解析后因 importer 未声明依赖而失败。已按"目标存在即可并"规则合并 +45 键。
3. **vitest 根 setupFiles 三件套未随迁**：`test-proxy-environment` / `test-invariants` /
   `test-dom-environment`。缺 `test-invariants`（跨包不变量宿主，为每个 `new Context()`
   装配 invariant 服务）时，goal 的写入期校验整体休眠——`session.append` 不再抛
   `goal snapshot change must have exactly`，读取期 fold 才报错，属静默行为漂移
   （DSH 基线同用例绿，KMH 红，最小复现定位）。三件已迁并接入。
4. **lib/src 双实例（运行时 symbol 分裂）**：bin 以 tsx 启动、`@deepseek-ai/*` 按
   根 paths 解析到 **src**，而 task profile 此前挂 **lib/index.js**——agent-loop 与
   tools 分属两个模块实例，`TOOL_RUNTIME_SCHEDULER` symbol 不一致，
   `ctx.tools[symbol]` 为 undefined，首次真模型工具调用即
   `Cannot read properties of undefined (reading 'prepare')`。第 5 步 echo 模型
   不发工具调用，故此链此前从未被踩到。修复：profile 全量改挂 `src/index.ts`
   （tsx 直跑 TS），与 paths 解析统一为单一实例。
5. **服务双注册用法错误（复刻第 3 步教训）**：`fs-local` 与 `fs-sandbox` 同挂会双注册
   `fs` 服务（fs-sandbox 内部继承 LocalFileSystem），`sandbox` 与 `sandbox-local`
   同理；profile 只挂实现方（fs-sandbox / sandbox+sandbox-policy），DSH base 的
   装配行本就如此。
6. **根 devDeps 测试共享外部件**：`js-yaml`、`execa` 按根对齐补入。
7. **测试语料**：`snapshots/`（sdk/session 全量，git 追踪语料）与
   `scripts/snapshots/`、`scripts/snapshot-workspace-parent.ts`、
   `packages/experimental/webworker-runtime/tests/fixtures`（llm-replay 语料登记表
   引用该路径，纯数据落盘、不带包本体）补入。
8. **allowBuilds 对齐**：`@google/genai`、`protobufjs` 与 DSH 根一致显式 `false`
   （pnpm 11 对未声明构建脚本退出非零）。

#### 第 6 步 import 错误记录（用户要求逐条留痕）

- **R0（闭包期预判，未拷贝）**：`packages/api/gateway` src 硬 import
  `@deepseek-ai/dsh-client-connection`（范围文档 §4 排除）——整包延期到 web 轮，
  base 的 `typert-gateway` 行在其迁入前不激活，`dsh-base` 清单修剪该依赖（台账在案）。
- **R1（tsc 首轮 TS2307，13 包补迁）**：被剪掉的 peer-only 包实际被 src 引用——
  `dsh-spill`（← tool-fs-search）、`dsh-output-retention`（← tool-jobs）、
  `dsh-workflow`（← tool-ralph/tool-workflow/workflow-ptc）、`dsh-agent-preset-registry`
  （← subagent、plugin-package-inventory-deepseek）、`dsh-deepseek-account`
  （← deepseek-account-platform、llm-deepseek-account）、`dsh-host-plugin-inventory`
  （← plugin-manager）、`dsh-host-webserver`（← deepseek-account-platform，提前于 web 轮落地）、
  `dsh-message-feedback`（← session-telemetry-otel）、`dsh-pwsh-local`（← pwsh-sandbox）、
  `dsh-session-telemetry`（← session-telemetry-otel）、`dsh-session-title-llm`
  （← session-title-first-prompt-llm）、`dsh-subagent-in-process-driver`
  （← subagent-fork/spawn-in-process）、`dsh-util-time`（← subagent）。自动迭代
  （解析 TS2307 → 补拷 → 接线 → install → 重查）两轮收敛。
- **R2（测试期，缺依赖/语料/补丁）**：`dsh-agent-preset`（← agent-preset-registry 测试，
  补迁）、`dsh-file-reference-local`（← agent-loop serial-listener-review 测试，连带
  file-reference 补迁）、`dsh-mcp-client`（← spill-policy multimodal 测试，补迁）、
  `dsh-schedule`（← subagent continuation 测试，补迁）、`dsh-web-search-exa`
  （← tool-web integration 测试，补迁）、`js-yaml`/`execa`（根 devDeps）、
  `snapshots/` 语料与 `snapshot-workspace-parent.ts`（← corpus / fs-sandbox 测试）、
  pi-ai 补丁（← llm-pi-ai tool-argument-streaming）、paths 子路径键
  （← tool-subagent/model-selection-settings）、`test-invariants` setup
  （← goal append 期校验，行为红非 import 红，一并留痕）。
- **R3（类型引用，集合外登记）**：`schedule` src 第 7 行
  `import type {} from '@deepseek-ai/dsh-api-session-controller'`——链至
  client-connection（范围排除），src 保持零差异、不修剪，包迁入但列类型检查集合外
  （vitest 不受影响：type-only 导入被擦除），web 轮随 api 组恢复。
- **环境限制（非 import）**：plugin-manager manager.spec 4 个用例经
  `apps/desktop/node_modules/pnpm`（范围排除的桌面壳内置 pnpm）执行真实 git+pnpm
  安装，KMH 必然解析失败——拆独立 project 以 `testNamePattern` 只跳过这 4 个，
  其余 76 个照常（DSH 基线同文件 80/80 绿，差异已核实为载体缺失而非迁移行为漂移）；
  另 operations.spec 在全量并发下偶现 pnpm.log FileHandle GC 未显式关闭的 unhandled
  error（单文件复跑稳定全绿、退出码 0，DSH 分区运行不复现），登记为已知偶发。

### 1~6 步总结

| 步骤 | 提交 | 包数累计 | 测试用例 | 感知 |
|---|---|---|---|---|
| 1 LLM 调用链 | `5403e2d3` | 26 | 6116 | echo 适配器全链调用 |
| 2 会话日志 | `feeed62c` | 29 | 6691 | 会话创建（session-1） |
| 3 工具底座 | `25f272ef` | 50 | 7886 | bash 工具真实执行命令 |
| 4 agent loop | `ea2d40e0` | 51 | 8222 | agentLoop 服务就绪（336 循环用例） |
| 5 headless 组装 | `767d9dc4` | 68 | 8286 | 一条命令跑完一个 agent 任务 |
| 6 base 闭环 | 本提交 | 166 | 18833 | 真模型 read 工具循环 + v4/zstd 会话落盘 |

## 7.5 基线一致性核对（随迁移演进）

迁移采用"src 源码 1:1 + 清单单向修剪"策略，与 DSH 基线的全部差异由
`scripts/diff-with-dsh.mjs` 自动核对并生成台账
[docs/architecture/kmh-dsh-baseline-delta.md](./kmh-dsh-baseline-delta.md)：

- **src 源码差异必须为 0**（硬约束，脚本非零退出）；曾有的唯一一处修剪
  （app-boot 的 system-prompt 类型导入）已随该包迁入恢复（提交 `e93b373a`）；
- **清单修剪**（package.json 依赖区、tsconfig references）逐条记录在台账，
  后续包迁入后按台账回填，重跑脚本差异清零即与基线完全一致；
- 每迁一批包后重跑一次脚本并提交台账变化。

## 8. 与范围文档的符合性

- §1 vendor/boot/util/apps-cli 四层全部覆盖（timer、logger-console、boot/hmr 一并迁入；
  config-editor 未迁——apps/cli 源码无引用，随需要补入）。
- §3 布局沿用 DSH；根级工程核对完成（workspace/lock/tsconfig；tsdown/vitest 入口
  随测试接线轮补入）。
- §4 排除项全部排除（desktop/web/client/website 均未迁入）；旧 `packages/` 按
  "保留本轮状态，明确替换与归档范围"处理为 legacy 归档。
- §5 依赖核对规则执行：从 CLI 入口源码引用出发逐包确认闭包，显式排除客户端产品
  与后端运行时依赖。
