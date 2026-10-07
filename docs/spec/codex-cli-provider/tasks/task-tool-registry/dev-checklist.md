# task-tool-registry · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

覆盖 feat03 场景9（工具目录变化后续聊）与 feat02 场景4 的 KMH 工具目录变化部分：KMH 工具统一声明 `kmh-` 前缀的双向映射、绑定记录版本化、目录变化时新建 thread 重新声明工具并按既有历史重建规则恢复上下文。feat02 场景4 的原生工具选择与技能变化部分由 task-native-tool-selection 覆盖（同场景的两种变化来源，机制不同故分属两个 task）。依赖 task-bridge-tools 与 task-session-binding 已交付的桥接、fork 与重建路径。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 声明名映射：KMH 工具对 Codex 统一声明 `kmh-<原名>`，建立声明名↔KMH 注册名双向表；前缀碰撞检查与前缀后名称的官方接受范围校验 | feat02 场景3 | packages/codex-cli/src/turn.ts, packages/codex-cli/src/protocol.ts | None | [ ] ⏳ |
| T2 | 回执解析与工具引用转换：服务端工具回调按声明表精确解析（兼容裸名），未知名称作为明确错误；旧绑定按其声明版本解析 | feat01 场景1, feat02 场景3 | packages/codex-cli/src/turn.ts | None | [ ] ⏳ |
| T3 | 绑定记录版本化：BindingRecord 增工具声明版本、目录指纹与名称映射，存量绑定记录兼容读取 | feat03 场景9 | packages/codex-cli/src/session-store.ts | 高:绑定记录格式变化影响既有会话恢复，验证须含存量绑定读取 | [ ] ⏳ |
| T4 | 目录变化检测与 thread 重建：新回合比较实际工具目录指纹，变化时新建可重新声明工具的 thread、按既有历史重建规则恢复上下文并更新绑定；`thread/resume`/`thread/fork` 继承旧工具集的行为一并核对 | feat03 场景9, feat02 场景4 | packages/codex-cli/src/adapter.ts, packages/codex-cli/src/turn.ts | 高:误判重建导致上下文重复或工具来源错乱，smoke 验证 | [ ] ⏳ |
| T5 | 恢复失败出路：重建失败显示明确原因与重新建立会话的入口 | feat03 场景9 | packages/codex-cli/src/adapter.ts | None | [ ] ⏳ |
| T6 | unit：前缀映射/碰撞/范围校验、未知名错误、绑定版本读写与存量兼容、目录变化触发重建 | feat02 场景3, 场景4, feat03 场景9 | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳ |
| T7 | smoke：真实 CLI 工具目录变化（增删改名）后续聊与分叉，历史保留、调用交给对应来源 | feat03 场景9, feat02 场景4 | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳ |

## 影响文件树

```text
kongming-agent/
├── packages/codex-cli/src/
│   ├── protocol.ts                  M  # 动态工具声明的前缀与名称范围校验
│   ├── turn.ts                      M  # kmh- 声明与回执解析、thread 重建时重新声明工具
│   ├── session-store.ts             M  # 绑定记录版本化：声明版本/目录指纹/名称映射
│   └── adapter.ts                   M  # 目录指纹比较、变化时触发重建、恢复失败错误
└── tests/runtime/codex-cli.test.mjs M  # 追加：映射/版本化/重建 unit 与 smoke
```
