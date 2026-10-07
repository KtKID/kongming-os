# task-tool-registry · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

覆盖 feat03 场景9（工具目录变化后续聊）与 feat02 场景4 的 KMH 工具目录变化部分：KMH 工具统一声明 `kmh-` 前缀的双向映射、绑定记录版本化、目录变化时新建 thread 重新声明工具并按既有历史重建规则恢复上下文。feat02 场景4 的原生工具选择与技能变化部分由 task-native-tool-selection 覆盖（同场景的两种变化来源，机制不同故分属两个 task）。依赖 task-bridge-tools 与 task-session-binding 已交付的桥接、fork 与重建路径。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 声明名映射：KMH 工具对 Codex 统一声明 `kmh-<原名>`，建立声明名↔KMH 注册名双向表；前缀碰撞检查与前缀后名称的官方接受范围校验 | feat02 场景3 | packages/codex-cli/src/tool-registry.ts, packages/codex-cli/src/turn.ts | None | [x] 🟢 |
| T2 | 回执解析与工具引用转换：服务端工具回调按声明表精确解析（兼容裸名），未知名称作为明确错误；旧绑定按其声明版本解析 | feat01 场景1, feat02 场景3 | packages/codex-cli/src/turn.ts | None | [x] 🟢 |
| T3 | 绑定记录版本化：BindingRecord 增工具声明版本、目录指纹与名称映射，存量绑定记录兼容读取 | feat03 场景9 | packages/codex-cli/src/session-store.ts | 高:绑定记录格式变化影响既有会话恢复，验证须含存量绑定读取 | [x] 🟢 |
| T4 | 目录变化检测与 thread 重建：新回合比较实际工具目录指纹，变化时新建可重新声明工具的 thread、按既有历史重建规则恢复上下文并更新绑定；`thread/resume`/`thread/fork` 继承旧工具集的行为一并核对 | feat03 场景9, feat02 场景4 | packages/codex-cli/src/adapter.ts, packages/codex-cli/src/turn.ts | 高:误判重建导致上下文重复或工具来源错乱，smoke 验证 | [x] 🟢 |
| T5 | 恢复失败出路：重建失败显示明确原因与重新建立会话的入口 | feat03 场景9 | packages/codex-cli/src/adapter.ts | None | [x] 🟢 |
| T6 | unit：前缀映射/碰撞/范围校验、未知名错误、绑定版本读写与存量兼容、目录变化触发重建 | feat02 场景3, 场景4, feat03 场景9 | tests/runtime/codex-cli.test.mjs | None | [x] 🟢 |
| T7 | smoke：真实 CLI 工具目录变化（增删改名）后续聊与分叉，历史保留、调用交给对应来源 | feat03 场景9, feat02 场景4 | tests/runtime/codex-cli.test.mjs | None | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
├── packages/codex-cli/src/
│   ├── tool-registry.ts             U  # 新增：kmh- 前缀双向映射、名称范围/碰撞校验、目录指纹与裸名兼容解析
│   ├── turn.ts                      M  # kmh- 声明与回执解析（未知名明确错误回执）、重建时重新声明工具
│   ├── session-store.ts             M  # 绑定记录版本化：声明版本/目录指纹/名称映射（可选字段非法剥除不弃记录）
│   ├── index.ts                     M  # recordBinding 落盘工具声明字段与版本递增
│   └── adapter.ts                   M  # 目录指纹比较、变化时 fresh 重建、恢复失败错误与声明约定说明
└── tests/runtime/codex-cli.test.mjs M  # 追加：映射/版本化/重建 unit 与目录变化 smoke
```

## 实施记录（2026-10-07）

- 目录变化重建必须走 fresh thread/start（`thread/resume` 与 `thread/fork` 都继承源线程
  的既有工具集，无法重新声明）；fresh 路径跳过 fork、以既有 rebuildText 注入历史，
  失败报 `CODEX_TOOL_CATALOG_REBUILD_FAILED` 并说明重试/新建会话出路。
- 旧绑定兼容：无指纹字段记录按裸名旧 thread 续用（resolve 的裸名回退以当前工具表为界，
  防旧名映射到已不存在的工具）；legacy thread 恢复续用后随下一轮记录当前指纹。
- 提示中的工具引用映射采用 developerInstructions 声明约定说明（一句话指出 KMH 工具名与
  kmh- 前缀声明名的对应），不做正文整词替换（D13 已注明会改写普通词义）；
  无工具的回合不注入。
- 未知名称回执为 `success:false` + `CODEX_TOOL_UNKNOWN` 文本（模型可见，turn 不挂起）。
- 验证：typecheck/lint 通过；28/28 全绿（新增目录变化 smoke：目录新增 → thread 更换、
  版本 1→2、重建标记与 kmh- 前缀工具进入模型请求；同目录第三轮 resume 不再重建）。
