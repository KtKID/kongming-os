# 验证策略与演进

## 验证策略

### 单元测试

- **覆盖模块**：全局 Provider Catalog、ModelProviderManager、Preset Writer、连接状态脱敏、低成本探测、错误映射。
- **框架**：pytest。
- **重点场景**：
  - MiniMax M3、GLM、DeepSeek catalog 返回稳定模型清单。
  - `connect()` 成功 upsert `web.llm_presets`。
  - `connect()` 写入 `.env` 的 provider 默认 env：MiniMax M3 写 `MINIMAX_API_KEY`，GLM 写 `GLM_API_KEY`，DeepSeek 写 `DEEPSEEK_API_KEY`；YAML 只保存 `api_key_env`。
  - fallback env 只参与读取历史配置；保存连接固定迁移到 provider 默认 env。
  - `KONGMING_MODEL_API_KEY` 只影响 CLI / 底层默认运行时配置，Web provider 连接状态保持 provider-specific key 口径。
  - MiniMax preset 的 `auth_header=Authorization` 与 `auth_value_template=Bearer {api_key}` 能进入运行时 provider。
  - GLM preset 的 `api_key_env=GLM_API_KEY` 能进入 OpenAI compatible runtime。
  - DeepSeek preset 的 `api_key_env=DEEPSEEK_API_KEY` 能进入 Anthropic compatible runtime。
  - `test_connection()` 使用 `content="ping"`、`max_tokens=1`、`timeout=15s`。
  - `test_connection()` 对 HTTP 2xx 返回成功并丢弃响应体。
  - `test_connection()` 使用 raw HTTP probe 作为唯一探测路径。
  - 同 preset id 二次连接执行更新。
  - API Key 不出现在列表 DTO。
  - 高级环境变量 JSON 非法时报 422。
  - mtime 冲突时报 409。

### 前端测试

- **覆盖模块**：Settings Provider Tab、provider 连接弹窗、Model Switcher。
- **框架**：vitest + React Testing Library。
- **重点场景**：
  - 服务商列表渲染 MiniMax M3、GLM、DeepSeek。
  - 点击连接弹窗出现 API Key 和高级 JSON 输入。
  - 测试连接按钮禁用/加载/错误状态。
  - 连接成功后刷新 presets。
  - 模型下拉支持搜索和选中态。
  - “管理服务商”跳转到 `/manage/model-providers`。

### 集成测试

- **端到端链路**：provider connect API → config / `.env` 写回 → app state 刷新 → `/api/presets` 返回新 preset → Generic Chat 创建 thread 带 `preset_id`。
- **环境要求**：真实 MiniMax / GLM / DeepSeek API Key 用手动验收；CI 使用 fake provider 或 monkeypatch provider factory。
- **触发方式**：x-verify 复跑 pytest 和 web vitest。

### 手动验证

- **必须人工过的场景**：
  - 桌面输入框底部模型切换视觉与按钮布局。
  - 窄屏下拉不遮挡输入框和发送按钮。
  - provider 弹窗错误提示可读。
  - 设置页已连接/添加服务商分区符合截图预期。
- **验收人**：功能 owner。

## 测试覆盖要求

| 模块 | 最低覆盖 | 重点文件 |
|------|----------|---------|
| Provider Catalog | 分支全覆盖 | `src/model_providers/catalog.py` |
| Provider Connection | 80% | `src/model_providers/model_provider_manager.py`、`src/model_providers/http_probe.py` |
| Preset Writer | 80% | `src/model_providers/preset_writer.py`、`src/infrastructure/config/config_write_manager.py` |
| Settings Provider Tab | 组件关键状态覆盖 | `web/src/modules/model-providers/**` |
| Model Switcher UI | 组件关键状态覆盖 | `web/src/components/ModelSwitcher.tsx` |
| Runtime Integration | contract 覆盖 | `src/hosts/web/threads/manager.py`、`web/src/stores/threads.ts` |

## 风险与 PoC

| 风险 | 等级 | 建议 |
|------|------|------|
| 真实连接测试受网络影响 | 中 | 探测固定为 `ping`、`max_tokens=1`、`15s` 超时；后端测试 mock HTTP 2xx |
| API Key 存储策略影响重启后可用性 | 中 | 固定写 `.env` 的 provider 默认 env，YAML 只保存变量名 |
| 共享默认模型 key 造成 Web provider 连接状态误判 | 高 | Web provider 连接状态只读 provider-specific key 与 fallback key |
| MiniMax Bearer 认证与 Anthropic provider 默认 `x-api-key` 冲突 | 高 | 扩展 preset/model auth header 策略并加运行时测试 |
| 输入框底部空间拥挤 | 中 | 先出 ModelSwitcher 独立组件和截图验收 |
| `web.llm_presets` list 写回复杂 | 中 | 先写 Preset Writer pytest，再接 UI |

## 演进路线

### 短期（本轮 task）

- [ ] MiniMax M3、GLM、DeepSeek provider catalog。
- [ ] Provider connect/test/disconnect API。
- [ ] Preset writer 写回 `web.llm_presets`。
- [ ] ConfigWriteManager 全局配置写回门户。
- [ ] Preset / Model auth header 策略。
- [ ] 管理页服务商 Tab 和 provider 连接弹窗。
- [ ] 输入框底部模型切换。
- [ ] provider-specific key 保存与 fallback 读取。
- [ ] `KONGMING_MODEL_API_KEY` 与 Web provider 连接状态隔离。

### 中期（下 1-2 轮）

- [ ] 支持自定义 OpenAI compatible provider。
- [ ] 支持 provider 模型列表手工增删。
- [ ] 支持连接诊断详情：认证、模型可用、网络耗时。

### 长期（方向性）

- Provider catalog 扩展到 Anthropic、OpenRouter 和更多自定义 OpenAI compatible provider。
- 模型上下文窗口、价格和额度接入。
- 多用户密钥隔离和安全存储。
