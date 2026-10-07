# task-image-artifact · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

覆盖 feat10（验收已有图片生成产物，R3 从简版）：在已交付的生图投影（projectImage）之上补实际像素尺寸展示、尺寸要求如实报告与接入失败双态；不另建改尺寸交付管线。独立于其他新 task，可先行。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | PNG 实际尺寸解析：读取产物元数据宽高（IHDR），投影时随图片块报告实际像素尺寸 | feat10 场景1 | packages/codex-cli/src/image-delivery.ts, packages/codex-cli/src/turn.ts | None | [x] 🟢 |
| T2 | 多图与重开可查：多次生图各自对应生成记录，已保存附件重新打开会话仍可查看 | feat10 场景1 | packages/codex-cli/src/turn.ts | None | [x] 🟢 |
| T3 | 尺寸要求从简：识别当轮用户输入的明确像素要求，产物不符时如实显示实际尺寸与要求尺寸、完成状态反映实际交付，不另存改尺寸副本 | feat10 场景2 | packages/codex-cli/src/image-delivery.ts, packages/codex-cli/src/turn.ts | None | [x] 🟢 |
| T4 | 产物接入失败双态：获取/保存/展示失败时分别显示生成成功与 KMH 接入失败及恢复入口（保留原生产物），不打断生成续推 | feat10 场景3 | packages/codex-cli/src/turn.ts | None | [x] 🟢 |
| T5 | unit：PNG 尺寸解析、尺寸要求识别与如实报告、双态失败展示（fixture 产物） | feat10 场景1-3 | tests/runtime/codex-cli.test.mjs | None | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
├── packages/codex-cli/src/
│   ├── image-delivery.ts            U  # 新增：PNG 实际尺寸解析与明确尺寸要求识别
│   └── turn.ts                      M  # projectImage 带实际尺寸、要求不符如实报告与接入失败双态
└── tests/runtime/codex-cli.test.mjs M  # 追加：尺寸/要求识别/双态 unit
```

## 实施记录（2026-10-07）

- `pngSizeOf` 只解析 PNG 签名 + IHDR 宽高；非 PNG/截断返回 undefined，附注如实占位"未知"。
- 尺寸要求识别按 R3 从简为"宽×高数字对（2–5 位数字）"即成立，不再要求语境词
  （首版语境词方案会漏掉"生成 256×256 的图标"这类常见说法）；单数字对（4x4 棋盘）天然不匹配，
  识别无副作用，偶发误识别只多一句附注。
- 附注文本块复用既有块摘要账目（push 的 blockDigest 入 pendingDigests），
  与图片块一同参与 turn 边界差分对账，不会引发基线误判重建。
- 接入失败双态仅在附件服务存在且读写失败时推送（headless 无附件服务保持静默跳过，
  避免每次生图噪音）；恢复入口=原生产物路径。
- 验证：codex-cli 包 typecheck/lint 通过，23/23 测试全绿（含真实 CLI smoke：
  bridge round trip、parallel tools、adapter recovers、multi-turn、compaction、edit-resend）。
