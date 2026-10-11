---
description: Web 开发时自动应用 KMH 自有插件的代码修改，记录需求、失败测试、实现和验收。
---

# Web 自动应用插件代码修改

> spec: docs/spec/kmh-plugin-framework-v0.1/spec.md
> feat: feat08
> 创建: 2026-10-11

## ① 需求

### 功能方向

- R1：日常 Web 启动后，修改自有插件代码会自动应用到当前服务，连续修改持续生效。
- R2：修改插件页面后，浏览器收到更新通知并能加载新页面内容。
- R3：错误修改显示诊断，修正后恢复更新；停止 Web 后释放本次启动的监听资源。

### 功能边界

本次补齐 KMH 自有插件的开发启动与代码更新流程，覆盖前台和后台共用入口。构建产物运行通过显式选项选择。DSH 底座源码、包管理器升级与插件业务逻辑继续由各自流程维护。

### 不能破坏的不变量

- I1：查看帮助和配置继续作为单次操作结束；调用者目录、环境、数据目录和退出状态保留。
- I2：插件更新沿用现有生命周期，独立插件持续运行，重复更新释放旧实例。
- I3：停止服务同时释放编译与页面更新监听；初始化失败释放已获得的资源。

## ② 测试用例（先写，此刻失败）

### unit

- U1：发现自有可构建插件并生成绝对产物目录；空目录返回空列表，缺失配置明确报错 → R1、I1。
- U2：真实启动入口导出的 HMR 配置使用启动器提供的代码目录；帮助、配置查看与构建产物选项保持单次运行 → R1、I1。

### smoke

- S1：真实编译监听收到源码修改后更新产物；类型错误保持上一份产物，修复后恢复；停止监听后后续修改保持产物原值 → R1、R3、I3。
- S2：真实页面构建监听更新 bundle，停止后释放资源 → R2、I3。
- S3：初始编译失败后释放此前已建立的监听 → R3、I3。

### e2e

- E1：通过 KMH Web 入口启动隔离服务，连续修改插件源码，核对同一服务进程应用新代码和旧实例清理；页面产物更新发出 rebuilt 事件 → R1、R2、I2、I3。
- E2：当前 3080 服务临时修改并还原自有插件源码，两次重载保持同一进程，原始源码完整还原 → R1、I2。

## ③ 技术实现

### 实现步骤

1. 启动器发现含源码和构建命令的自有包，逐个开启 TypeScript 编译监听；配置导出、帮助和 `--no-watch` 继续单次执行。
2. 两个 CLI 插件的页面构建脚本导出 `watchClient()`，初次构建后由 esbuild 持续监听；直接运行构建脚本继续执行原有完整构建。
3. 启动器向 Web 子进程提供绝对 `lib/` 目录列表，profile 把这些目录交给现有 DSH HMR。前台与后台共用这个入口，DSH 子模块保持当前代码。
4. 编译使用轮询监听和 `noEmitOnError`。停止时取消排队的编译任务并关闭 TypeScript 与 esbuild：TypeScript 6 的 `WatchProgram.close()` 保留排队任务，单独取消它们保证关闭后的监听持续释放。
5. 完成仓库回归后，一次切换当前后台 Web 到新的启动流程；随后在该服务上完成两次热重载验收。

### 涉及文件

- `scripts/plugin-watch.mjs`：包发现、初次编译、持续监听、错误恢复与资源关闭。
- `scripts/kmh.mjs`：Web 默认监听、产物运行选项、单次命令与停止收尾。
- `packages/codex-cli/build.mjs`、`packages/zcode-cli/build.mjs`：可复用的页面监听入口。
- `profiles/kmh-web/cordis.patch.yml`：接入启动器提供的绝对代码目录。
- `package.json`：将新增脚本和修改的构建脚本接入现有语法检查。
- `tests/runtime/plugin-watch.test.mjs`：U1/U2/S1/S2/S3 共 5 项行为测试。
- `tests/runtime/web-plugin-hmr.test.mjs`：E1 的真实 Web 入口、连续重载、页面通知与停止验收。
- `docs/kmh/README.md`：开发启动、失败处理、监听归属与包接入说明。
- `profiles/kmh-web/README.md`、`docs/kmh/adding-a-plugin-package.md`：关联热更新操作入口。
- 本任务文档：需求、测试、实现和验收记录。

## ④ 验证结果

### 失败证据与测试修正

先写 2 项测试，运行旧实现得到 2 项失败，原因是源码监听模块尚未提供：

```text
node --test tests/runtime/plugin-watch.test.mjs
ℹ tests 2
ℹ pass 0
ℹ fail 2
ERR_MODULE_NOT_FOUND: scripts/plugin-watch.mjs
```

原生文件事件漏掉首次源码变化后改用轮询。页面变更期间立即停止的测试复现了残留文件监听，取消编译定时器后关闭测试与测试进程均正常结束。

测试准备按 macOS 临时目录的真实路径启动入口，避免 `/var` 与 `/private/var` 导致入口判断跳过。配置导出保留 `!!js` 表达式，U2 核对表达式接入，绝对路径的真实生效由 E1/E2 验证。当前 Web 的页面检查按已有 token → 303 跳转 → cookie 流程执行，最终鉴权请求返回 200。

### 测试输出

```text
node --test tests/runtime/plugin-watch.test.mjs
ℹ tests 5
ℹ pass 5
ℹ fail 0

node --test tests/runtime/web-plugin-hmr.test.mjs
✔ 真实 Web 连续应用插件源码并推送页面更新，服务 PID 保持一致
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

真实 Web 测试监听端口时在沙箱中返回 `listen EPERM`，原样在宿主运行通过。E1 完整检查两次旧实例清理、相同服务 PID、ZCode 页面 bundle 的新内容、`rebuilt` 事件和停止后的进程/监听释放。

E2 在沿用 `/Users/kid/.kmh-dev` 的当前服务上临时添加源码注释，再完整还原，实际输出：

```json
{"pid":30362,"reloads":2,"apply":3,"unload":2,"sourceRestored":true,"authenticatedWebStatus":200}
```

### 不变量回归

首次 `pnpm test` 自动触发依赖安装并遇到 registry 连接失败；本次命令级关闭自动安装，复用已安装依赖完成真实回归。依赖声明与锁文件的既有改动保持原样。

```text
pnpm_config_verify_deps_before_run=false pnpm test
pretest: pnpm build:kmh（5 个自有包构建成功）
ℹ tests 186
ℹ pass 186
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 122282.198833

pnpm_config_verify_deps_before_run=false pnpm lint
5 个自有包 lint: Done
退出状态 0

node node_modules/prettier/bin/prettier.cjs packages/codex-cli/build.mjs packages/zcode-cli/build.mjs --check
All matched files use Prettier code style!

git diff --check
退出状态 0
```

本次 12 个文件变更均属于 KMH 层；当前已有的提供方修复、其他文档和工作区文件继续保留，DSH 子模块保持当前版本。

### 结论

- [x] 所有需求点被测试覆盖
- [x] 所有测试真实跑过且通过
- [x] 实现在边界内
- [x] 不变量未破坏
