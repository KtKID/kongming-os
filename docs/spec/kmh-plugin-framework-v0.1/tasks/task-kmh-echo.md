# 保存插件生命周期名字

> spec: docs/spec/kmh-plugin-framework-v0.1/spec.md
> feat: feat08
> 创建: 2026-10-04

## ① 需求

R1：加载、更新、重启和卸载时，将发生的阶段名字逐行追加到本地文件。默认文件为 `/tmp/kmh-echo/events.log`，使用者可以设置其他绝对路径。

R2：自动创建文件所在目录，保留已有记录；每次写入同步落盘。错误路径和文件写入失败时报告错误。

R3：CLI、Web 和 SDK 均加载这个示例。SDK 继续通过标准输入输出交换消息。重复更新和重启后，每次更新只记录一次。

本任务采用本轮确认的完整 DSH 底座与 Kongming 自有包布局，实现 feat08 的生命周期示例。阶段记录包含 `apply`、`effect`、`update`、`unload`；系统按临时目录规则清理 `/tmp`。

## ② 测试用例

1. 自动创建目录，三次更新、一次重启和重复卸载，核对逐行记录及监听清理 → R1、R2、R3。
2. 已有记录及第二个容器继续追加 → R2。
3. 更新文件路径时，旧文件记录更新和清理，新文件记录加载和清理 → R1。
4. 默认路径与空路径、相对路径、错误类型拒绝；运行中的非法更新保留已有记录 → R2。
5. 文件阻塞目录创建、目录被用作日志文件时加载报错并保留原内容 → R2。
6. 三个公开 profile 最终配置各包含一个实例及本地依赖 → R3。
7. 公开 SDK 实际启动、JSON-RPC shutdown 和持久化清理记录 → R1、R3。

## ③ 技术实现

`packages/kmh-echo/src/index.ts` 使用函数式 `apply`、Schemastery 配置校验和同步追加写入。一个 effect 同时拥有更新监听与清理函数，每次文件写入使用 `flush: true`。更新文件路径时旧文件记录更新与卸载，新文件记录重新激活。

`packages/kmh-echo/package.json` 和 `tsconfig.json` 定义本地 ESM 构建、严格类型检查和 DSH 本地依赖。根 `package.json`、`pnpm-lock.yaml` 与 `eslint.config.mjs` 声明编译及检查工具；根 lint 和 typecheck 纳入自有插件，test 前构建插件并按测试文件串行执行。`scripts/kmh.mjs` 在完整底座构建后构建自有插件，`.gitignore` 忽略本地产物。

三个 `profiles/kmh-{headless,sdk,web}/package.json` 使用 `link:` 声明插件，三个 `cordis.patch.yml` 各插入一个实例。`tests/runtime/kmh-echo.test.mjs` 保存七项行为测试。包 README、当前运行架构和底座说明记录安装、构建、配置与验证入口。

## ④ 验证结果

首次运行 `node --test tests/runtime/kmh-echo.test.mjs` 因插件尚未实现而失败，输出 `ERR_MODULE_NOT_FOUND`，目标是 `packages/kmh-echo/lib/index.js`。实现后配置校验测试发现 Schemastery transform 的异常类型及回调参数行为，改为带明确字段路径的 `ValidationError`；测试保留对 Cordis `invalid config` 的要求。

最终 `pnpm test` 的真实汇总：

```text
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

新增插件测试 7 项通过；既有启动回归 12 项通过。公开 SDK 启动测试使用独占目录覆盖日志路径，验证完整 `apply\neffect\nunload\n` 文件内容和 JSON-RPC shutdown 响应。默认 `/tmp/kmh-echo/events.log` 也由既有 SDK 运行测试实际创建并追加名字。

`pnpm build:kmh`、`pnpm typecheck:kmh`、`pnpm lint`、`pnpm format:check`、`git diff --check` 均退出成功。锁文件以 `pnpm install --offline --frozen-lockfile` 验证。

- [x] R1、R2、R3 均有对应行为测试。
- [x] 七项新增测试及十二项既有测试真实运行并通过。
- [x] 实现采用本轮确认的自有插件位置、函数式入口与文件输出。
- [x] SDK 消息输出和既有 profile 启动回归通过。
