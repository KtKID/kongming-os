# provider · 开发清单

> spec: docs/spec/zcode-cli-provider/spec.md
> 创建: 2026-10-04
> risk: Q2

| #   | 任务                                   | 场景回指       | 涉及文件                                                                                                                                                                                                      | 风险                  | 状态   |
| --- | -------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------ |
| T1  | 模型请求、完整提示与 read 循环         | feat01 场景1-3 | packages/zcode-cli/src/{index,protocol,prompt}.ts、tests/runtime/zcode-cli.test.mjs、tests/runtime/fixtures/zcode-cli/                                                                                        | None                  | [x] 🟢 |
| T2  | 官方账号存储、进程生命周期和登录操作   | feat02 场景1-4 | packages/zcode-cli/src/{runtime,account,config,personal-config,authorize-url,bigmodel-login}.ts、packages/zcode-cli/vendor/zcode/                                                                             | 高:账号鉴权与异步进程 | [x] 🟢 |
| T3  | 现有插件配置区内的登录和最小连通测试   | feat03 场景1-3 | packages/zcode-cli/src/web.ts、packages/zcode-cli/src/client/、packages/zcode-cli/src/status.ts                                                                                                               | 高:账号操作入口       | [x] 🟢 |
| T4  | 独立打包、配置和文档                   | feat04 场景1-2 | packages/zcode-cli/{package.json,tsconfig*.json,build.mjs,README.md}、profiles/kmh-web/{package.json,cordis.patch.yml}、package.json、pnpm-lock.yaml、eslint.config.mjs、docs/task/task-zcode-cli-provider.md | None                  | [x] 🟢 |
| T5  | 人工账号授权交接与真实最小连通测试验收 | feat02 场景5   | None                                                                                                                                                                                                          | 高:真人授权           | [x] 🟢 |
| T6  | 会话工作目录跟随与回落                 | feat05 场景1-3 | packages/zcode-cli/src/{runtime,index}.ts、packages/zcode-cli/package.json、tests/runtime/zcode-cli.test.mjs、tests/runtime/fixtures/zcode-cli/cli.mjs                                                            | None                  | [x] 🟢 |
| T7  | 桌面端登录只读借用与来源展示           | feat06 场景1-4 | packages/zcode-cli/src/{account,runtime,status}.ts、packages/zcode-cli/src/client/{AccountCard.tsx,locales.ts}、tests/runtime/zcode-cli.test.mjs                                                              | 高:凭据与账号状态     | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
├── packages/zcode-cli/src/                U  # provider、提示、read 限制、账号与 Web
├── packages/zcode-cli/vendor/zcode/       U  # 固定来源的官方密码模块和许可证
├── packages/zcode-cli/package.json        U  # 独立公开导出
├── packages/zcode-cli/tsconfig*.json       U  # 分开的 Host 与 Browser 编译程序
├── packages/zcode-cli/build.mjs           U  # Host 编译与标准 Client 插件打包
├── packages/zcode-cli/README.md           U  # 使用前提与验证范围
├── profiles/kmh-web/package.json          M  # 安装账号插件
├── profiles/kmh-web/cordis.patch.yml       M  # 挂载插件并保留标准预设和用户模型选择
├── package.json                           M  # 纳入自有构建及检查
├── pnpm-lock.yaml                         M  # 新插件依赖
├── eslint.config.mjs                     U  # 覆盖 TS 与 TSX 的类型规则
├── tests/runtime/zcode-cli.test.mjs        U  # 协议、生命周期和请求级工具筛选与工具往返
├── tests/runtime/fixtures/zcode-cli/       U  # 模拟官方进程和协议请求记录
└── docs/task/task-zcode-cli-provider.md    U  # 早期调查与当前实施入口
```
