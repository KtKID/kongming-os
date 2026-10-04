# 目标与边界

## 一、为什么做（用户痛点）

### 痛点 1：跑了等于没跑

**v0.2 现象**（实测于 2026-05-03）：

```
用户在 CLI 创建任务："今日五十分钟提醒"，schedule = 18:50（北京）
↓
ticker 在 18:50:00.373 准时触发（延迟 0.37s，调度链路完美）
↓
fresh session sched-task-34a8c2f1d4e6-07f008db582c 跑完
↓
final_message 落到 .kongming/cron/runs/task-34a8c2f1d4e6.jsonl
↓
**用户什么都没看到**
```

`silent_marker_enabled: true` 默认开 + CLI/web 都没订阅 fresh session 的 EventSink → 终端 / 前端零回声。

### 痛点 2：任务无法管理

- 用户问"我之前那个 50 分提醒到底跑了没" → 只能 `cat .kongming/cron/scheduled_tasks.json` 翻 JSON
- 用户想暂停某个任务 → 没接口
- 用户想看"最近一周所有 cron 触发了几次" → 没接口

### 痛点 3：fresh session 不落盘（v0.2 隐性 bug）

`.kongming/sessions/sched-*` 目录从来没被建过，意味着 cron 跑的整个对话历史（system prompt + tool calls + reasoning + assistant message）跑完即丢，磁盘上只剩 `final_message_excerpt`（一段截取摘要），事后无法审计。

## 二、做完之后能做什么（核心场景）

### 场景 A：CLI 用户

```
用户：每 30 秒提醒我喝水
agent：[创建 task-abc123，channel=cli]

[30 秒后，ticker 触发]
[59 秒后用户敲下一条消息前]

> 喝水！      ← cron flush 在这里打印（一行系统消息样式）
> [user input prompt]
```

### 场景 B：web 用户

1. 顶部 ⏰ 按钮（带红点 = 有新触发未读）
2. 点开 → `/cron` 页
3. Tab「任务列表」：
   - 卡片样式：name / schedule / next_run / last_run / state
   - 行内按钮：⏸暂停 / 🗑删除
4. Tab「触发记录」：
   - 时间倒序 list
   - 每条卡片：任务名 / 触发时间 / 完整 final_message / 跳转到 task 详情
5. 关掉 tab → 红点清掉

### 场景 C：审计 / 调试

```
用户："为什么 50 分那次回复跑偏了？"
你：cat .kongming/sessions/sched-task-34a8c2f1d4e6-07f008db582c/messages.jsonl
   → 看到完整的 system prompt + 用户 input + LLM 回复全过程
```

## 三、明确不做

| 不做 | 理由 |
|---|---|
| feishu / email / Slack 推送 | 远端集成超出 v0.3 范围；保留接口位（`channel: "web" \| "cli"` 用 Literal，未来可加） |
| web 表单手动创建 cron | LLM 自然语言比表单强（`every 30s` / `0 9 * * *` 都自动转换）；表单不优 |
| 列表页"修改任务" | 增加 schema 复杂度且语义不明（修改后 next_run_at 怎么办？）；删了重建更简单 |
| 跨 thread / 跨 workspace 共享 | 当前 cron 文件式存储，单 home 单用户，没多用户语义 |
| thread 过滤 / 任务分组 | 用户可能就 5-10 个 cron 任务，分组属于过度设计 |
| 流式投递 | cron 用户不在场，没必要看打字 |
| 失败重试自动化 | 已在 v0.2 `retry_limit` 字段保留，本次不动 |
| 投递失败的可视化告警 | 写到 `delivery_error` 字段就够了，前端简单展示，不做 toast |
| websocket → mobile push | 移动端没规划 |

## 四、价值与优先级

| 价值 | 优先级 | 说明 |
|---|---|---|
| cron 触发结果用户可见 | **P0** | 没这个 cron 等于不存在 |
| cron 任务可管理（看/暂停/删）| **P0** | 否则用户每次都要手改 JSON |
| fresh session 落盘修复 | **P0** | 隐性数据丢失 bug，调试痛点 |
| 红点未读状态 | P1 | 提升可用性，但红点逻辑可后做 |
| CLI flush 模式 | P1 | CLI 用户少，web 优先 |
| schedule_tool 加 delivery 字段 | P1 | 默认值能 work 就行 |

## 五、约束与不变量

1. **不破坏 v0.2 已上的 ONCE/INTERVAL/CRON/SECONDS 触发逻辑** —— 调度核心不动
2. **不动 ticker 的 60s tick 节奏** —— delivery 是后置环节，跟 tick 解耦
3. **schema 升级保留 v2 备份** —— `.kongming/cron/scheduled_tasks.json.v2.bak.<ts>`
4. **不引入新协议 Protocol** —— delivery 用硬编码 if/elif 路由，控制扩展面
5. **不动 cron 安全审计**（`audits.jsonl`）—— delivery 写自己的字段，跟 audit 链路并行
6. **CLI 不破坏 prompt_toolkit 输入流** —— flush 必须等下次提示符前
