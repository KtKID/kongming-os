# task-image-artifact · 开发清单

> spec: docs/spec/codex-cli-provider/spec.md
> 创建: 2026-10-07

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

覆盖 feat10（验收已有图片生成产物）：在已交付的生图投影（projectImage）之上补实际像素尺寸展示、明确尺寸要求下的交付图与如实完成状态。尺寸处理"能力"的具体来源（可用工具或内置实现）在 T3 实施时定位并记入 decisions.md。独立于其他新 task，可先行。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | PNG 实际尺寸解析：读取产物元数据宽高（IHDR），投影时随图片块报告实际像素尺寸 | feat10 场景1 | packages/codex-cli/src/image-delivery.ts, packages/codex-cli/src/turn.ts | None | [ ] ⏳ |
| T2 | 多图与重开可查：多次生图各自对应生成记录，已保存附件重新打开会话仍可查看 | feat10 场景1 | packages/codex-cli/src/turn.ts | None | [ ] ⏳ |
| T3 | 明确尺寸要求与交付图：识别当轮用户输入的明确像素要求；产物不符且具备已获授权的处理能力时保留原图、另存交付图并按实际尺寸核对后报告完成；能力来源实施时定位 | feat10 场景2 | packages/codex-cli/src/image-delivery.ts, packages/codex-cli/src/turn.ts | None | [ ] ⏳ |
| T4 | 尺寸处理不可用或失败：显示实际尺寸、要求尺寸与未满足条件，原图可保存，完成状态反映实际交付 | feat10 场景3 | packages/codex-cli/src/turn.ts | None | [ ] ⏳ |
| T5 | 产物接入失败双态：获取/保存/展示失败时分别显示生成成功与 KMH 接入失败及恢复入口（保留原生产物），不打断生成续推 | feat10 场景4 | packages/codex-cli/src/turn.ts | None | [ ] ⏳ |
| T6 | unit：PNG 尺寸解析、尺寸要求识别、交付核对、双态失败展示（fixture 产物） | feat10 场景1-4 | tests/runtime/codex-cli.test.mjs | None | [ ] ⏳ |

## 影响文件树

```text
kongming-agent/
├── packages/codex-cli/src/
│   ├── image-delivery.ts            U  # 新增：PNG 实际尺寸解析、明确尺寸要求识别与交付图核对
│   └── turn.ts                      M  # projectImage 带实际尺寸、交付图投影与接入失败双态
└── tests/runtime/codex-cli.test.mjs M  # 追加：尺寸/交付/双态 unit
```
