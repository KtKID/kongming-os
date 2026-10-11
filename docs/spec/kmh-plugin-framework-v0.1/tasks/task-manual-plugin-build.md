---
description: 取消 Web 启动时的插件源码自动编译，保留手动构建后的 DSH 热重载。
---

# 手动构建插件后应用修改

> spec: docs/spec/kmh-plugin-framework-v0.1/spec.md
> feat: feat08
> 创建: 2026-10-11

## ① 需求

### 功能方向

- R1：保存插件源码后，当前 Web 保持原有代码，由使用者决定何时构建。
- R2：手动构建后，当前 Web 应用新的插件代码和页面，连续构建持续生效。
- R3：现有 Web 关闭此前启动的自动编译监听，日常启动使用已构建文件。

### 功能边界

本次调整 KMH 启动、构建入口、对应测试与文档。插件加载、释放与页面替换继续由 DSH 负责。插件包版本升级、业务逻辑与其他工作区修改由各自任务维护。

### 不能破坏的不变量

- I1：帮助和配置查看保持单次操作；调用者目录、环境、数据目录与退出状态继续转发。
- I2：手动构建更新时清理旧插件实例，Web 保持运行；配置热更新继续生效。
- I3：停止服务释放运行资源，其他现有修改保持原样。

## ② 测试用例（先写，此刻失败）

### unit

- U1：真实入口的帮助与配置导出正常结束，帮助使用当前的手动构建启动语义 → R3、I1。

### e2e

- E1：隔离 Web 使用已构建文件启动；保存后等待并确认 Host 与页面产物保持原值；显式构建两次 Host 并构建页面，检查同进程重载、旧实例释放、页面 rebuilt 通知、构建进程退出和停止释放 → R1、R2、R3、I1、I2、I3。
- E2：当前 3080 Web 切换启动后，保存并还原临时源码修改，产物和重载记录保持原值 → R1、R3、I3。

## ③ 技术实现

### 实现步骤

1. 删除源码编译监听模块与启动器中的编译/页面监听调用，Web 直接使用已构建文件；帮助回归正常 Web 入口。
2. 启动器继续向现有 DSH HMR 提供自有包的绝对 `lib/` 目录，只收集已存在的产物目录。
3. 两个 CLI 插件的构建脚本执行一次 TypeScript 与页面打包后结束。构建保留已存在的产物并覆盖更新，让已有文件的变化被 HMR 观察到。
4. 替换自动编译测试，验证保存源码保持运行代码、手动构建后连续重载和页面更新；同步当前指南并标注之前任务的后续调整。
5. 仓库回归通过后切换一次当前后台 Web，释放旧启动进程持有的编译监听，验证保存源码后的产物保持原值。

### 涉及文件

- `scripts/kmh.mjs`：使用已有产物启动并提供 HMR 目录。
- `scripts/plugin-watch.mjs`：删除自动编译监听模块。
- `packages/codex-cli/build.mjs`、`packages/zcode-cli/build.mjs`：恢复单次构建，移除页面监听入口。
- `package.json`：清理已删除脚本的语法检查。
- `tests/runtime/plugin-watch.test.mjs`：删除已取消功能的测试。
- `tests/runtime/plugin-build.test.mjs`：真实帮助和配置导出。
- `tests/runtime/web-plugin-hmr.test.mjs`：手动构建与同进程 HMR 验收。
- `docs/kmh/README.md`、`profiles/kmh-web/README.md`、`docs/kmh/adding-a-plugin-package.md`：手动构建操作与接入。
- `task-web-plugin-hmr.md`：注明后续手动构建调整。
- 本任务文档：需求、实现与验证结果。

## ④ 验证结果

### 失败证据

先调整用例并运行旧实现。U1 失败于旧帮助仍宣称默认监听源码；E1 失败于保存源码后产物已经从 `apply-v1` 自动更新为 `apply-v2`。

```text
node --test tests/runtime/plugin-build.test.mjs
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError: help matched /--no-watch|默认监听自有插件源码/

node --test tests/runtime/web-plugin-hmr.test.mjs
ℹ tests 1
ℹ pass 0
ℹ fail 1
AssertionError: artifact contains apply-v2, expected apply-v1
```

E1 首次在沙箱运行得到 `listen EPERM`；原样在宿主执行后复现上述自动编译行为。

### 测试输出

```text
node --test tests/runtime/plugin-build.test.mjs
✔ Web 帮助与配置导出使用已有构建产物并正常结束
ℹ tests 1
ℹ pass 1
ℹ fail 0

node --test tests/runtime/web-plugin-hmr.test.mjs
✔ 保存源码保持现有代码，手动构建后 Web 连续热重载并更新页面
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ duration_ms 10011.123959
```

E1 检查 Host 与页面各自保存后等待 1800 毫秒，产物保持原值；显式构建触发 Host 连续两次重载并清理旧实例，页面产物触发 `rebuilt`，服务 PID 保持一致，构建进程与停止后的 Web 均正常退出。

### 当前服务验收

沿用 `/Users/kid/.kmh-dev` 执行一次 `./kmh.sh restart`，服务从 PID 30362 切换到 PID 54409。新服务启动使用已有产物。临时保存源码注释后等待 2200 毫秒，再完整还原并等待 1500 毫秒，产物内容、修改时间与插件生命周期日志均保持原值；鉴权页面返回 200。

```json
{"pid":54409,"savedSourceKeptArtifact":true,"restoreKeptArtifact":true,"pluginReloads":0,"sourceRestored":true,"authenticatedWebStatus":200}
```

### 不变量回归

```text
pnpm_config_verify_deps_before_run=false pnpm test
pretest: pnpm build:kmh（5 个自有包构建成功）
ℹ tests 182
ℹ pass 182
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 117758.257625

pnpm_config_verify_deps_before_run=false pnpm lint
5 个自有包 lint: Done
退出状态 0

node node_modules/prettier/bin/prettier.cjs packages/codex-cli/build.mjs packages/zcode-cli/build.mjs --check
All matched files use Prettier code style!

git diff --check
退出状态 0
```

回归包括 U1/E1、工作目录与环境继承、公开启动、停止信号转发，以及已有提供方行为。原有 5 项自动编译测试替换为 1 项手动构建入口测试，真实 Web 用例保持 1 项，总数从 186 调整为 182。本次 13 个文件均属于 KMH 层，DSH 子模块与既有其他改动保持原样。

### 隔离测试的浏览器设置

E1 每次申请一个临时端口，并复制 KMH 的完整 Web 配置。原配置的 `web-runtime.config.openBrowser: true` 固定启用浏览器交接；`--no-open` 提供的 `ctx.webStartup.openBrowser` 只有配置引用该值时才生效，因此此前运行 E1 会打开临时端口页面。测试副本现在明确设置 `openBrowser: false`，启动前验证配置，停止后检查整个运行输出保持无浏览器交接记录。

新增断言先在启动 Web 前复现 `true !== false`；调整测试副本后重新运行 E1，1 项通过，耗时 10782.626542 毫秒。浏览器标签页清单保持原样，日常 Web 继续由 PID 54409 监听 3080；51499 已无监听进程。本次补充调整测试和本任务记录，正式 profile 保持原配置。

后续[自动审查任务](../../codex-cli-provider/tasks/task-auto-review.md)将正式 profile 接到 `webStartup.openBrowser`；当前 E1 直接使用该启动值，以 `--no-open` 验证浏览器交接关闭。前两段记录首次隔离测试修复时的配置与进程状态。

### 结论

- [x] 所有需求点被测试覆盖
- [x] 所有测试真实跑过且通过
- [x] 实现在边界内
- [x] 不变量未破坏
