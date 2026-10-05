---
description: kmh/zcode-cli 连接测试的 reasoning level 错误、真实 CLI 对照验证与修复建议。
---

# ZCode 连接测试正确性调查

> Report ID: 20261005-reasoning
> Schema: x-cr-v2
> Mode: known-issue
> Scope: module
> Task ID: zcode-cli-provider/provider
> Review 日期：2026-10-05（Asia/Shanghai）
> 审查范围：连接测试、生成请求转换、CLI 模型配置与参数校验、账号来源、相关测试和规格。

连接测试强制发送 `disabled`，本机官方 CLI 0.16.9 为 GLM-5.3-Flash 声明的档位为 `low / high / max`。真实 CLI 复现用户的完整错误；相同账号、模型、ping、空工具列表与输出上限 1，改用 `high` 后成功，耗时 11429 ms。

## 调查对象

| 字段 | 内容 |
| --- | --- |
| 模式 | 已知问题 |
| 用户现象 | `ZCODE_MODEL_CONNECTION_FAILED`，CLI 返回 `invalid_model_request` 和 `Reasoning level is required for account:bigmodel-individual-coding-plan/GLM-5.3-Flash` |
| 期望行为 | 可用账号点击测试连接后，最小模型请求成功 |
| 实际行为 | 连接测试在 CLI 参数校验阶段失败 |
| 归属 spec | `docs/spec/zcode-cli-provider/spec.md`，feat01 场景2、feat03 场景2 |
| spec 定位方式 | provider/dev-checklist.md 的 spec 指针 |

## 模块模型与审查范围

| 层级 | 对象 | 输入与信任属性 | 校验或状态所有者 | 副作用或下游 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 入口 | 插件账号 API / `check()` | 宿主授权请求、插件配置 | Web connection / ZcodeCli | 发起最小 ping | `packages/zcode-cli/src/web.ts`、`runtime.ts:513` |
| 主模块 | `generate()` | KMH 类型化请求 | 请求投影、工具筛选 | `workspace/generateText` | `runtime.ts:549-583` |
| 账号所有者 | `readAccount()`、`raw()` | 加密持久凭据 | 官方密码模块、宿主鉴权回调 | 向指定账号提供请求鉴权 | `account.ts`、`runtime.ts:390-506` |
| 契约邻居 | 官方 ProviderRegistry / ModelSelectionFacade | 进程 JSON 请求 | 模型档位校验、有效选择解析 | 参数错误或模型生成 | 本机 `zcode.cjs` 的 bpe、PWt、Vie、$En |
| 模型配置 | builtin revision 30 | 官方安装文件 | 合并后的 optionSpecs | GLM-5.3-Flash 支持 low/high/max | 本机 `config/provider/zcode-builtin.json` 的 modelRules[6] |
| 证据与测试 | runtime 测试、CLI 夹具 | 模拟账号和模型响应 | fixture 接受输入 | 测试把 disabled 当成功条件 | `tests/runtime/zcode-cli.test.mjs:138-147`、`tests/runtime/fixtures/zcode-cli/cli.mjs` |

## 不变量覆盖

| INV-ID | 来源类型 | 不变量 | 来源 / 依据 | 本次触达路径 | 最小反例 | 结论 | 关联问题 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| INV-SPEC-01 | spec 声明 | 可用账号的最小连通测试能够验证当前模型 | feat03 场景2 | check → generate → CLI 校验 | 已登录 + GLM-5.3-Flash + disabled → invalid_model_request | 破坏 | B1 |
| INV-SPEC-02 | spec 声明 | 普通请求默认使用高思考等级 | feat01 场景2 | generate → reasoningLevel 配置 | 相同 ping 使用 high → ready | 保持 | - |
| INV-SPEC-03 | spec 声明 | 错误展示保持凭据隔离 | feat02 场景4、feat03 场景2 | raw → diagnostic → PublicStatus | CLI 参数错误 → 公开模型 ID 和提示 | 保持 | - |
| INV-SPEC-04 | spec 声明 | 账号操作使用插件 cwd | feat05 场景3 | check → generate，无 sessionId | 最小 ping → 配置 cwd | 保持 | - |
| INV-CAND-01 | 补充候选 | 夹具应拒绝当前模型不支持的 reasoning level | CLI optionSpecs、真实失败 | fixture generateText | disabled 被夹具接受，真实 CLI 拒绝 | 破坏 | B2 |

INV-CAND-01 属于 spec 缺口：现有规格记录请求档位与成功状态，测试设计需加入当前模型支持值的兼容校验。其余提示、工具执行、登录授权、退出和工作目录会话恢复路径属于本次调查的范围之外，保持既有实现。

## 贝叶斯根因调查

| H | 关联 INV-ID | 先验 | 证据 E | 影响 | 更新后置信度 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| H1：探测档位与 CLI 模型配置冲突 | INV-SPEC-01 | 高 | check 写死 disabled；官方值为 low/high/max；真实错误完全一致；high 成功 | 支持 | 已确认 | 探测采用配置 reasoningLevel |
| H2：网络或账号权益导致本次失败 | INV-SPEC-01 | 中 | 同一账号、同一地址和模型的 high 请求成功 | 削弱 | 低 | 保留当前账号和连接配置 |
| H3：CLI 升级引起协议漂移 | INV-SPEC-01 | 中 | 当前版本仍为已验证的 0.16.9；CLI 内置规则明确 | 削弱 | 低 | 修正插件请求和规格 |
| H4：夹具遗漏 reasoning 校验 | INV-CAND-01 | 中 | 测试断言 disabled，夹具只镜像 maxOutputTokens 校验 | 支持 | 已确认 | 加入支持档位校验与拒绝用例 |

## Spec 对照

feat03 场景2和 README 将 `disabled` 记作该模型的可用探测档位；实现遵循了这条描述。官方 0.16.9 的 GLM-5.3-Flash 配置要求 `low / high / max`，所以问题属于原始 spec 与外部 CLI 规则不一致。feat01 的默认 `high` 与真实成功请求一致。

## 审查结论

### P0：阻断性正确性错误

| ID | 状态 | INV-ID | 检查项 | 置信度 | 描述 |
| --- | --- | --- | --- | --- | --- |
| - | ✅ | - | 本级无问题 | 已确认 | 本次证据涉及可恢复的连接测试失败 |

### P1：生产正确性风险

| ID | 状态 | INV-ID | 检查项 | 文件:位置 | 置信度 | 根因分类 | 描述 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | ✅已修复 | INV-SPEC-01 | 探测参数兼容性 | `packages/zcode-cli/src/runtime.ts:523` | 已确认 | 原始 spec 不一致 | 写死 disabled 导致可用账号的测试连接失败 |

### P2：正确性证据或契约缺口

| ID | 状态 | INV-ID | 检查项 | 文件:位置 | 置信度 | 根因分类 | 描述 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B2 | ✅已修复 | INV-CAND-01 | 夹具模型参数校验 | `tests/runtime/zcode-cli.test.mjs:147` | 已确认 | spec 缺口 | 模拟测试接受真实 CLI 拒绝的档位 |

## 问题详情

### B1: 连接测试强制使用 GLM-5.3-Flash 不支持的 disabled

**关联不变量**：INV-SPEC-01。**严重程度**：P1。**置信度**：已确认。**根因分类**：原始 spec 不一致。

`check()` 在 runtime.ts:523 显式设置 `ReasoningEffortId("disabled")`，`generate()` 原样写入 `selection.options.reasoningLevel`。CLI 的 `validateModelSelectionOptions` 将该值判为不支持；`resolveEffectiveModelSelection` 在无有效档位时生成只含 providerId/modelId 的选择，后续 `requireModelSelection` 报缺少 reasoning level，映射为 `invalid_model_request`。因此错误文本显示“required”，请求中的实际值是 `disabled`。

最小反例为已登录账号执行 `check()`。真实 CLI 输出与用户错误一致，普通请求使用相同账号和 `high` 成功，排除了当前这次参数拒绝由网络或账号权益触发的假设。个人配置只调整地址和输出上限；默认 high 被 check 的显式值覆盖。

修复建议：连接测试使用插件配置的 `reasoningLevel`（当前 high），同步更新 feat03 场景2和 README。保留 ping、空工具列表和明确超时；思考 token 与耗时应按实际模型行为说明。当前原始错误提示与过滤逻辑保持有效。

**处置结果**：✅已修复。连接测试按用户指定改用 low，普通会话默认 high。规格与 README 同步说明支持档位和思考 token。

### B2: 模拟 CLI 缺少 reasoning 支持值校验

**关联不变量**：INV-CAND-01。**严重程度**：P2。**置信度**：已确认。**根因分类**：spec 缺口。

现有成功测试在 zcode-cli.test.mjs:147 断言探测发送 disabled，夹具在 `workspace/generateText` 路径验证 maxOutputTokens 后继续返回成功，覆盖遗漏了真实 CLI 的档位约束。这使测试可以持续接受 B1 的错误请求。

修复建议：夹具声明 GLM-5.3-Flash 的 low/high/max 支持值，对 disabled 返回真实错误；成功探测断言配置档位；补充参数拒绝与凭据过滤验证。最短补证为修复后运行聚焦 runtime 测试，并以同账号执行真实 `check()`。

**处置结果**：✅已修复。夹具拒绝无效 reasoning level；回归测试覆盖 disabled 拒绝、low 探测恢复 ready 以及清除旧错误。

## 验证记录与覆盖声明

真实对照通过独立临时测试运行，复制既有加密账号文件到权限受控的临时目录，使用现有构建的 ZcodeCli 和本机官方 CLI。测试结束回收子进程并删除临时目录；原始凭据、正在运行的 Web 与产品源码保持原状。

| 检查 | 结果 |
| --- | --- |
| `zcode --version` | 0.16.9 |
| 官方 builtin | revision 30，GLM-5.3-Flash 档位 low/high/max |
| disabled 真实探测 | `ZCODE_MODEL_CONNECTION_FAILED` / `invalid_model_request` / Reasoning level is required |
| high 真实生成 | ready，11429 ms，finishReason stop，textLength 586 |
| 独立测试 | `node --test /tmp/kmh-zcode-reasoning-check.test.mjs`，宿主执行 1/1 通过 |
| 沙箱限制 | 首次 CLI 启动遇到 Unix socket listen EPERM；同命令宿主重跑完成对照 |
| spec 相关规则 | 本次连接测试、默认档位、错误隔离与账号操作目录已覆盖 |
| 主模块与契约邻居 | 请求生成、官方规则、选择解析和失败映射已核对 |
| 状态与权限所有者 | 既有加密账号读取成功，原始账号状态保持 |
| 入口、失败路径与副作用 | 子进程临时目录隔离，公开诊断与退出回收已观察 |
| 测试与运行证据 | 真实参数对照完成；夹具兼容校验缺口见 B2 |

P0：0；P1：1；P2：1。根因已确认。建议将探测档位统一为配置 high，并同步规格、README 和夹具测试。


## 修复备注

> 修复日期：2026-10-05（Asia/Shanghai）

| ID | INV-ID | 严重程度 | 文件 | 处置结果 | 修复方式 | 反例 / 验证 |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | INV-SPEC-01 | P1 | runtime.ts、README.md、spec.md | ✅已修复 | check 显式 low，保留会话默认 high | 真实 CLI check 成功，7319 ms；连接 ready，错误和诊断清除 |
| B2 | INV-CAND-01 | P2 | cli.mjs、zcode-cli.test.mjs | ✅已修复 | 夹具校验支持档位，回归覆盖失败后探测恢复 | 模块测试 32/32 通过 |

模块 build、Host/Browser typecheck、lint、format:check、修改的测试与夹具语法检查、git diff --check 均通过。真实验证采用现有构建与隔离账号副本；当前 Web 进程需重启以加载新构建。修复后的历史调查结果保留在原表，当前处置以本节为准。
