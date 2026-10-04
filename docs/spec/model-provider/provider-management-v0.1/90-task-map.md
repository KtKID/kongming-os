# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| ConfigWriteManager + Provider Catalog + Provider Connection + Preset Writer | `model-provider-backend` | 无 | DoD#1、DoD#2、DoD#3、DoD#6、DoD#7、DoD#8 | 高，先锁定 auth header 与 raw HTTP probe | 可进入 x-req | 后端全局模块和 API 契约先落地 |
| Settings Provider Tab | `model-provider-settings-ui` | `model-provider-backend` | DoD#1、DoD#2、DoD#8 | 低 | 可进入 x-req | 复用现有 dashboard UI 基础组件 |
| Model Switcher UI + Runtime Integration | `composer-model-switcher` | `model-provider-backend` | DoD#4、DoD#5、DoD#8 | 中，需桌面/窄屏截图验收 | 可进入 x-req | 将 `ModelSwitcher` 从 `Composer` 中独立出来 |

## 推荐顺序

1. `model-provider-backend`
   - 定义 DTO 和全局 `ModelProviderManager`。
   - 新增 `ConfigWriteManager`，全局模块通过它执行配置写回。
   - MiniMax catalog。
   - raw HTTP 连接测试和错误映射，探测固定为 `ping` / `max_tokens=1` / `15s` / 2xx 成功，只读取 HTTP status。
   - Preset Writer upsert `web.llm_presets`，同步写 `.env` 和 app state。
   - 扩展 `LLMPresetConfig` / `ModelConfig` auth header 策略，MiniMax 使用 `Authorization: Bearer {api_key}`。
   - API tests。

2. `model-provider-settings-ui`
   - 新增 `/manage/model-providers` route。
   - `ManagePage` 左侧新增“服务商”Tab。
   - 服务商列表、已连接列表、MiniMax 弹窗。
   - 连接成功刷新状态和 presets。

3. `composer-model-switcher`
   - 新增 `ModelSwitcher` 组件。
   - Composer 底部接入模型按钮。
   - 新增 `PATCH /api/threads/{thread_id}/preset` 和 ThreadManager 门户方法。
   - Generic Chat 下一次发送使用选中 preset。

## PoC 建议

| PoC | 目标 | 验收 |
|-----|------|------|
| Preset Writer PoC | 验证 list 字段原子 upsert 和 pydantic 校验 | pytest 写入临时 YAML 后 `load_config()` 成功 |
| MiniMax Test PoC | 验证 Anthropic 兼容 endpoint、Bearer header、raw HTTP probe 请求形态 | fake transport 断言 header/payload/2xx，真实 key 手动通过 |
| Model Switcher Layout PoC | 验证输入框底部布局 | Playwright 桌面和窄屏截图通过 |
