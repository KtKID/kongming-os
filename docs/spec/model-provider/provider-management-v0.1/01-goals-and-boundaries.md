# 目标与完成标准

## 系统目标

模型服务商管理模块为 Kongming 全局运行时提供统一的模型接入入口：服务商连接、连接测试、preset 生成、模型切换和运行时使用。Web 是首版配置界面，CLI 后续复用同一套 `ModelProviderManager` 和 preset 能力。

## 完成目标（DoD）

- [ ] DoD#1：管理页出现“模型服务商”Tab，能展示已连接服务商和可添加服务商，首批可添加服务商为 MiniMax。
- [ ] DoD#2：点击 MiniMax “连接”打开弹窗，可填写 API Key 和高级环境变量 JSON，可执行测试连接。
- [ ] DoD#3：连接成功后系统写回 `config/setting.yaml` 的 `web.llm_presets`，生成可用于 Generic Chat 的 MiniMax preset。
- [ ] DoD#4：输入框底部显示模型切换控件，支持搜索、按服务商分组、选中态和进入服务商管理页。
- [ ] DoD#5：新建 Generic Chat 会话时使用当前选择的 preset，运行时仍通过 `apply_preset()` 和 `build_provider()` 构造 provider。
- [ ] DoD#6：API Key 只接受写入和测试，列表接口只返回连接状态、provider 名称、模型名、脱敏摘要。
- [ ] DoD#7：MiniMax preset 的运行时认证使用 `Authorization: Bearer <key>`，连接测试和 Generic Chat 调用使用同一套认证策略。
- [ ] DoD#8：后端和前端都有可重复测试覆盖，验证代码全部落在 `tests/` 或 `web/src/**/__tests__/`。

## 范围边界

**包含**：
- 新增 `src/model_providers/` 全局模块，门户类命名为 `ModelProviderManager`。
- 新增 Web REST API 作为首版宿主适配层：服务商目录、连接状态、连接测试、保存连接、断开连接、preset 列表刷新。
- MiniMax 首版默认 Anthropic 兼容端点：`https://api.minimaxi.com/anthropic`，默认模型名 `MiniMax-M3`。
- `web.llm_presets` 继续作为 Generic Chat 可用模型 preset 真源。
- `LLMPresetConfig` / `ModelConfig` 增加认证头策略字段，支持 Anthropic 兼容端点使用 Bearer token。
- 输入框底部模型切换只对 Generic Chat 生效；Claude Code 和 Codex 通道展示自身通道模型上下文。

**暂缓范围**：
- provider 动态 discovery，例如调用远端 `/models` 拉取完整模型目录。
- API Key 加密存储和多账号隔离。
- CLI 模型切换命令和外部 CLI 通道的模型切换落地。
- provider 价格、额度、模型上下文窗口实时查询。

## 关键约束

- 模块门户统一使用 `ModelProviderManager`，外部模块只调用 manager 或协议 DTO。
- 跨模块共享协议如需要进入核心合同，只放 `src/core/contracts/`；Web 专属 DTO 留在 `src/hosts/web/protocol/`。
- `src/core/` 保持零 sibling 依赖；模型服务商管理属于全局配置与 provider 装配能力，Web 只提供界面和路由适配。
- `src/model_providers/` 不能 import `hosts.web.*`；配置写回能力必须通过 `src/infrastructure/config/` 的全局门户调用。
- 运行时代码继续通过 `LLMPresetConfig`、`apply_preset()`、`build_provider()` 构造 LLM provider。
- API Key 保存到 `.env`，preset 只写 `api_key_env`；浏览器列表保持脱敏。
- 验证必须使用 pytest / vitest 测试文件。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| DoD#1 | Provider Catalog + Settings Provider Tab | `model-provider-settings-ui` | 待实现 |
| DoD#2 | Provider Connection + Settings Provider Tab | `model-provider-backend`, `model-provider-settings-ui` | 待实现 |
| DoD#3 | Preset Writer + Provider Connection | `model-provider-backend` | 待实现 |
| DoD#4 | Model Switcher UI + Provider Catalog | `composer-model-switcher` | 待实现 |
| DoD#5 | Runtime Integration + Preset Writer | `model-provider-backend`, `composer-model-switcher` | 待实现 |
| DoD#6 | Provider Connection + Provider Catalog | `model-provider-backend` | 待实现 |
| DoD#7 | Provider Connection + Preset Writer + Runtime Integration | `model-provider-backend` | 待实现 |
| DoD#8 | 全部模块 | 每个 task 自带测试项 | 待实现 |
