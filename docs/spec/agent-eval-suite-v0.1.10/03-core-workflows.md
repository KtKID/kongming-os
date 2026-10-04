# 核心流程

## 流程 1：编写 case → 执行 → 判分 → 报告

```
作者编写 CaseSpec
  │
  ├─ 定义 lane
  ├─ 定义输入、fixture、enabled_tools
  ├─ 定义期望：result / events / artifacts / semantic
  │
  └─ 交给 suite harness
          │
          ├─ 组装 runtime
          │    ├─ SessionEngine.build(...)
          │    ├─ stub or replay provider
          │    ├─ session_factory
          │    ├─ tools / approval / event_sinks
          │    └─ optional prompt_debug_sink
          │
          ├─ 执行一次 run 或一次宿主交互
          │
          ├─ 收集 ExecutionRecord
          │    ├─ Result
          │    ├─ trace events
          │    ├─ session snapshot
          │    ├─ prompt-debug
          │    └─ artifact paths
          │
          ├─ Graders 逐项判分
          │    ├─ exact assertions
          │    ├─ trace assertions
          │    ├─ artifact assertions
          │    └─ optional semantic grader
          │
          └─ 汇总为 SuiteReport
```

**关键点**：

- case 的输入是“完整运行条件”，不是一条 prompt 文本。
- 判分直接消费 `ExecutionRecord`，不重新解释 runtime 内部实现。
- suite 报告必须能回链到 trace、session、prompt-debug 这些事实文件。

## 流程 2：安全链 case

```
CaseSpec 指定：
  tool_name / arguments / enabled_tools / approval script / safety config
      │
      ├─ runtime 组装 capability / permission / consent / trust / boundary
      │
      ├─ Runner 触发 tool_call
      │
      ├─ SafetyGatedApproval.decide()
      │    ├─ hard block
      │    ├─ boundary resolution
      │    ├─ trust grant hit
      │    └─ explicit consent
      │
      ├─ emit approval.* / tool.denied / tool.silently_allowed
      │
      └─ grader 断言：
           - 最终 outcome
           - decision metadata
           - tool 是否真正执行
           - trace 顺序是否完整
```

**关键点**：

- 安全测试的主判分对象是 `decision + trace + side effect`。
- “用户看见 ask 了” 只是一个子断言。
- `silent_allow`、`hard_block`、`explicit_consent` 都要独立成 case family。

## 流程 3：上下文与持久化 case

```
CaseSpec 指定：
  session seed / prior messages / compactor config / instruction sources
      │
      ├─ runtime 执行多轮 run
      │
      ├─ session append / reload / compact
      │
      ├─ 产出：
      │    - session JSONL
      │    - assembled messages
      │    - prompt-debug dump
      │
      └─ grader 断言：
           - system 注入次数
           - recent history 保留
           - compact 后关键消息仍在
           - usage / tool_calls 等字段 shape 正确
```

**关键点**：

- `Session / Context` 的测试对象是“可见输入状态”，不是某个函数返回值。
- `prompt-debug` 和 `session JSONL` 应该双证据交叉验证。

## 流程 4：Web / Host case

```
CaseSpec 指定：
  host_mode=web
  thread seed / ws frames / runtime preset / auth context
      │
      ├─ Web app / thread_manager 装配 runtime cell
      ├─ WS endpoint 收发 frame
      ├─ thread file / history frame / event sink fanout
      └─ grader 断言：
           - protocol round trip
           - thread boot / evict / resume
           - approval frame 正确
           - event replay 正确
```

**关键点**：

- Web 测试仍然属于同一套框架测试集。
- 它测的是“宿主桥接是否忠实承载 runtime”，不是另一个独立系统。

## 流程 5：真实链路 smoke case

```
少量高价值 case
  │
  ├─ 使用真实 provider 或本地兼容端点
  ├─ 保留最小工具集
  ├─ 打开 trace / raw dump / prompt-debug
  └─ grader 只断言稳定事实：
       - run 成功
       - trace 存在
       - streaming 关键事件存在
       - session / artifact shape 正确
```

**关键点**：

- smoke lane 追求“真连接、真落盘、真回收”。
- smoke lane 不承担大范围语义评分。
