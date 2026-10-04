# 核心流程

## 1. MiniMax 连接流程

```mermaid
sequenceDiagram
  participant U as User
  participant UI as Settings Provider Tab
  participant API as Web model-providers router
  participant M as Global ModelProviderManager
  participant P as Raw HTTP Probe
  participant W as Preset Writer
  participant Y as config/setting.yaml

  U->>UI: 点击 MiniMax 连接
  UI->>UI: 打开连接弹窗
  U->>UI: 输入 API Key / 高级 JSON
  UI->>API: POST /api/model-providers/{provider_id}/test
  API->>M: test_connection(request)
  M->>P: 发送 ping 探测 max_tokens=1 timeout=15s
  P-->>M: 返回 HTTP status
  M->>M: 2xx 记为成功并丢弃响应体
  M-->>API: TestConnectionResult
  API-->>UI: 连接诊断
  U->>UI: 点击连接
  UI->>API: POST /api/model-providers/{provider_id}/connect
  API->>M: connect(request)
  M->>W: upsert_preset(minimax)
  W->>Y: 原子写回 web.llm_presets
  W->>Y: 写入 .env 中的 API Key 变量
  W-->>M: PresetUpsertResult + app state refresh
  M-->>API: ProviderConnectionDTO
  API-->>UI: 已连接状态 + preset_id
```

## 2. 输入框模型切换流程

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Load["加载 presets<br/>P0 · GET /api/presets"]:::p0
  Normalize["组装选项<br/>P1 · provider 分组 + 搜索字段"]:::p1
  Select["用户选择模型<br/>P0 · 得到 preset_id"]:::p0
  Thread["更新 thread metadata<br/>P0 · 当前会话下一次发送生效"]:::p0
  Send["发送消息<br/>P1 · GenericChatProvider 带 preset_id"]:::p1
  Runtime["运行时构造 provider<br/>P1 · apply_preset/build_provider"]:::p1

  Load --> Normalize --> Select --> Thread --> Send --> Runtime
```

## 3. Preset 写回流程

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Input["ConnectProviderRequest<br/>P0 · API Key / model / base_url"]:::p0
  Validate["校验请求<br/>P0 · JSON / model / endpoint"]:::p0
  Build["构造 LLMPresetConfig<br/>P0 · minimax-m3"]:::p0
  Read["读取 setting.yaml<br/>P1 · 当前 mtime"]:::p1
  Upsert["upsert web.llm_presets<br/>P0 · 同 id 更新"]:::p0
  Check["pydantic 校验<br/>P0 · Config 合法"]:::p0
  Persist["原子写回<br/>P0 · rename 生效"]:::p0
  Refresh["返回 preset_id<br/>P1 · 前端刷新列表"]:::p1

  Input --> Validate --> Build --> Read --> Upsert --> Check --> Persist --> Refresh
```

## 生效时机

| 操作 | 生效范围 | 说明 |
|------|----------|------|
| 连接 MiniMax | preset 列表刷新后可见 | 后端写 YAML + `.env`，同步更新 app state，前端立即刷新 `/api/presets` |
| 新建 Generic Chat | 首条消息起生效 | 创建 thread 时使用当前选中的 `preset_id` |
| 已有 Generic Chat 切换 | 下一次发送生效 | `PATCH /api/threads/{thread_id}/preset` 更新 metadata，正在运行的 run 继续使用启动时 provider |
| 断开服务商 | 新建/切换时不可选 | 历史 thread 保留原 `preset_id`，发送前校验 preset 可用性 |
