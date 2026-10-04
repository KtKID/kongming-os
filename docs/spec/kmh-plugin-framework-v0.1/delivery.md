# KMH 基础框架交付

六项规则和工程约束已落实。四个 task 完成，50 个规格场景通过，58 个真实测试通过，静态检查通过；原有 Python 核心消息与会话 23 项回归通过。

## 入口

在 kongming-agent 仓库执行：

```sh
pnpm --dir packages install
pnpm --dir packages build
pnpm --dir packages kmh profile create demo
pnpm --dir packages kmh bundle install example/bundle.yml --profile demo
pnpm --dir packages kmh run --profile demo --input hello
pnpm --dir packages acceptance
```

默认数据目录为 ~/.kmh，可用 --home 指定。交互运行输入 status、call kmh-consumer hello、unload kmh-provider、reload kmh-provider、stop。配置和敏感字段展示说明见 packages/cli/README.md。

## 交付结构

所有实现、测试、示例、检查与构建脚本均在 packages。RuntimeManager 驱动固定官方 Cordis；ProfileManager 管理文件及组合；ExampleManager 提供服务和事件示例；CliManager 提供 kmh 应用入口；kmh-base 为必选基础 bundle。代码文件使用中文说明，并在每个函数及回调前标注中文职责、输入和输出。

## 验证证据

packages/tooling/evidence.json 将每个规格场景映射到实际测试或静态检查，记录参考文件摘要与 KMH 的差异依据。packages/tooling/acceptance.json 是本次实际通过、失败和待验证状态；acceptance 命令可重新生成。真实测试包含严格启动与整次回收、依赖撤回与恢复、异步重载串行、失败清理、时限报告、隔离哨兵、持久化竞争和构建后交互链路。

本次在本机 macOS、Node 25.6.1 验证。规格采用本地 bundle 和显式配置重载；Agent、Thread 与其他业务能力按后续阶段接入。当前工作区保留实现和文档，可直接审阅。
