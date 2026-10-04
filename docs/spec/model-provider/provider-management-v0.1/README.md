# provider-management-v0.1

> 状态：历史设计，已由 OpenSpec change [`model-catalog-runtime-config-separation`](../../../../openspec/changes/model-catalog-runtime-config-separation/) 取代。当前实现使用 catalog v2、`ModelCatalogManager`、`setting.model.preset_id/reasoning_effort` 与 provider-specific credential env；本文中的 `web.llm_presets`、`LLMPresetConfig` 和静态 `KONGMING_MODEL_*` 链路只用于理解旧版本。

> 状态：可进入 x-req
> 目标：把模型服务商接入做成全局独立模块，当前 Web provider catalog 覆盖 MiniMax M3、GLM、DeepSeek，并在聊天输入框底部切换模型。

## 系统目标

模型接入从零散 YAML 编辑升级为全局服务商管理能力。Web 是首版配置界面，CLI 后续可复用同一套 provider catalog、connection state、preset writer 和 `ModelProviderManager`。

## 最小可用路径

用户进入运行管理的“模型服务商”Tab → 选择 MiniMax M3 / GLM / DeepSeek → 填 API Key 和高级环境变量 JSON → 测试连接成功 → 系统写入 provider 默认 env 与 `web.llm_presets` → 输入框底部下拉显示对应模型并可切换当前会话 preset。

## 范围边界

**包含**：
- 后端新增全局 `ModelProviderManager` 门户，统一服务商目录、连接测试、preset upsert、脱敏读取和配置写回。
- 管理页新增“模型服务商”Tab，provider catalog 覆盖 MiniMax M3、GLM、DeepSeek。
- MiniMax 连接弹窗支持 API Key、高级环境变量 JSON、测试连接、连接保存。
- provider key 使用 provider-specific env：MiniMax 写 `MINIMAX_API_KEY`，GLM 写 `GLM_API_KEY`，DeepSeek 写 `DEEPSEEK_API_KEY`。
- 历史 fallback env 只参与读取；保存连接固定写 provider 默认 env。
- `KONGMING_MODEL_API_KEY` 属于 CLI / 底层默认模型配置；Web provider 连接状态和保存连接使用 provider-specific env。
- 输入框底部新增模型切换控件，支持搜索、分组、选中态、跳转管理页。
- Generic Chat 会话创建和发送继续通过 `preset_id` 选择运行时模型。

**暂缓范围**：
- 多用户密钥隔离和云端账号 OAuth。
- CLI 模型切换命令和外部 CLI 通道的真实切换。
- provider 市场、动态模型拉取、价格展示、额度管理。
- API Key 明文从浏览器回显。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| Provider Catalog | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-1provider-catalog) | 是 | MiniMax M3 / GLM / DeepSeek 元数据和默认模型清单 |
| Provider Connection | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-2provider-connection) | 是 | 连接测试、保存、断开、脱敏状态 |
| Preset Writer | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-3preset-writer) | 是 | 写回 `web.llm_presets` 和当前选中 preset |
| Model Switcher UI | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-4model-switcher-ui) | 是 | 输入框底部下拉、搜索、分组、选中态 |
| Settings Provider Tab | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-5settings-provider-tab) | 是 | 管理页服务商 Tab 和 provider 连接弹窗 |
| Runtime Integration | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-6runtime-integration) | 是 | `preset_id` 到 `SessionEngine` 的既有链路增强 |

## 文档导航

- [架构图](./architecture.html)（浏览器双击打开）
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 先进入 `model-provider-backend`，落全局 `ModelProviderManager`、MiniMax M3 / GLM / DeepSeek catalog、连接测试和 preset 写回。
2. 再进入 `model-provider-settings-ui`，做管理页 Tab 和 provider 连接弹窗。
3. 最后进入 `composer-model-switcher`，接入输入框底部模型切换和当前会话 preset 选择。

## 当前实现口径

早期 spec 以 MiniMax 首版接入为主线；当前实现已扩展为 MiniMax M3、GLM、DeepSeek 三个 provider-specific key。

| Provider | 默认写入 env | fallback 读取 env | 运行时 preset key |
|----------|--------------|-------------------|-------------------|
| MiniMax M3 | `MINIMAX_API_KEY` | `KONGMING_PROVIDER_MINIMAX_API_KEY` | `MINIMAX_API_KEY` |
| GLM | `GLM_API_KEY` | `BIGMODEL_API_KEY` / `ZHIPU_API_KEY` / `ZAI_API_KEY` | `GLM_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` | 无 | `DEEPSEEK_API_KEY` |

保存连接固定写 provider 默认 env；fallback env 保留历史配置读取能力。`KONGMING_MODEL_API_KEY` 继续服务 CLI / 底层默认运行时模型配置。
