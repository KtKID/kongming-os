# 新增 Kongming 自有插件包

为新建 `packages/<name>` 包并挂进 profile 提供逐文件清单，以 `packages/runtime-log`（最小插件模板）与 `packages/zcode-cli`（完整插件模板）为参照验证。清单与实际仓库有出入时先在此修正。DSH 子模块内的包结构规范见其[实操手册](../../third_party/dsh/docs/cookbook/adding-a-package.zh.md)，本文只覆盖 Kongming 侧的接入环节。

## 适用范围

在 Kongming `packages/` 下新增 Cordis 插件包（含 `name`/`inject`/`apply`/`Config` 导出），并使其在 `cli`、`web`、`sdk` 任一 profile 中可加载。纯 bundle（只有 `cordis.patch.yml`、无代码，如 `packages/kmh-dev-preset`）只需第 3、4 步。

## 逐文件清单

| 序 | 文件 | 变更 | 漏掉的后果 |
| --- | --- | --- | --- |
| 1 | `packages/<name>/package.json` | `exports` 指向 `./lib/index.js`；peerDependencies 用版本号声明 DSH 对等依赖，devDependencies 用 `link:../../third_party/dsh/...` 镜像同一批包（类型与本地开发） | 构建或类型检查失败 |
| 2 | `packages/<name>/tsconfig.json` + `src/index.ts` | 抄 `packages/runtime-log/tsconfig.json`；源码顶部中文说明功能与关键函数 | — |
| 3 | 根 `package.json` 四处 filter | `build:kmh`、`typecheck:kmh`、`lint`、`format:check` 的 `--filter` 列表各加 `@kmh/<name>` | `pnpm test` 的 pretest 不构建本包，测试导入 `lib/` 失败 |
| 4 | `profiles/<profile>/cordis.patch.yml` | insert 区加插件行（`id` + `name: '@kmh/<name>'` + 可选 `config`） | 插件不进入配置树，`pnpm config:web` 查不到 |
| 5 | `profiles/<profile>/package.json` | `dependencies` 加 `"@kmh/<name>": "link:../../packages/<name>"` | **loader 导入失败**：HMR 日志（`~/.kmh/logs/plugins/runtime-<pid>.jsonl`）报 `failed to import`，Web 插件面板显示"配置已启用、运行未运行" |
| 6 | `tests/runtime/<name>.test.mjs` | `node:test` 直引 `../../packages/<name>/lib/index.js`，随 `pnpm test` 自动执行 | — |
| 7 | 文档 | 单包 `README.md`；`docs/kmh/README.md` 自有插件段落提及；跨包能力按需 | — |

完成 1、3 后跑 `pnpm install` 更新根锁文件（锁文件须与包声明同批提交）；完成 5 后跑 `pnpm run setup` 建立链接并重启对应服务。配置或插件改动在 Web 侧生效都需要重启，HMR 只覆盖已加载插件的代码变化，拉不起全新模块。

## 机制说明

loader 解析插件模块说明符的基准是 profile 目录的 `node_modules`，不是仓库根。`scripts/kmh.mjs` 的 `prepareProfiles` 遍历各 `profiles/*/package.json` 的 `dependencies`，把所有 `link:` 规格手工链接到 `profiles/<profile>/node_modules/<pkg>`（幂等：相同链接保持，冲突报错），并把 profile 目录链接进 KMH 运行数据目录。根 pnpm workspace（`packages/*`）只负责构建与测试，不参与运行时解析——这是漏掉第 5 步时根目录一切正常、唯独导入失败的原因。

## 验证入口

新增包后按序执行：

```
cd profiles/<profile> && node -e "import('@kmh/<name>').then(m => console.log(Object.keys(m)))"
./kmh.sh restart
grep -i "failed to import" ~/.kmh/logs/plugins/runtime-<新pid>.jsonl   # 应无输出
```

Web 侧用插件面板确认"运行状态"为运行中；`pnpm config:web` 只能看到配置条目（第 4 步的结果），看不到模块解析是否成功。

## 维护归属

插件包本体随代码提交维护；本清单随接入流程的结构变化（例如 `prepareProfiles` 或 filter 列表机制调整）同步修订。2026-10-09 由 `@kmh/web-surface-zh` 接入踩坑（漏第 5 步）补齐。
