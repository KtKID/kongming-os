# 召回模式库

[分类](../SKILL.md#分类)的探针，在 DSH 子模块 2026-08 清理期间调校。每个命中都需要语义判断——模式库按设计过匹配，也天生欠匹配：历次清理的人工复查都能发现没有任何模式抓到的案例，所以要把它们与对范围内最密集文字的无模式通读配对。

## 调用规则

- 加 `--hidden --glob '!.git/**'` 使 `.agents/` 被搜索；ripgrep 默认跳过点目录，而笔记归档正是历次清理最大的漏报风险。
- 排除放在最后，防止后续包含把它们重新纳入：`--glob '!third_party/**' --glob '!node_modules/**' --glob '!.agents/notes/archived/**' --glob '!.agents/skills/kmh-trim-cot-leakage/**'`（本技能自己的文件引用泄漏措辞作校准；`.agents/notes/archived/` 为 DSH 子模块的归档目录，Kongming 层保留排除以防御同类目录出现），加上范围内已记录的夹具与快照目录。[拥有者技能](../SKILL.md)也通过其引用的证据自命中；按证据判断，而不是按使用判断。
- 自然语言的行带 `-i`，使句首大写能命中（"This PR adds…"、"Probably fine…"）；匹配代码模式的首行保持大小写敏感——`-i` 会把 `\bT\d\b` 和 `\bP-I\b` 变成噪音。
- 给完整短语定界。`\bthis PR\b` 必须匹配 "this PR adds" 而不匹配 "this project"、"this process" 或 "this provider"。
- 零命中的模式在命中已知阳性之前证明不了任何事；嘈杂的模式在拒绝近似阴性之前也证明不了任何事。信任语料结果前先把两者都校准。
- 把写作语言探针对准相反语言的表面：在以英文为主的 Markdown 和代码注释/JSDoc 里搜中文残留，在 `*.zh.md` 里搜中文变更叙述。在中文正文里对英文残留做泛 ASCII 搜索在代码和标识符附近太嘈杂；改为把新增正文与其对应物比较。

## 英文模式库

```sh
rg -n --hidden '\(decision \d|\(audit [A-Z]\d|design §|plan §|design ledger|\(B ruling|\bP-I\b|\bW\d\b|\bT\d\b' ...
rg -n --hidden -i '\bthis PR\b|\bthis branch\b|\bthis stack\b|\blater PRs?\b|\bprevious commits?\b|\bthis commit\b' ...
rg -n --hidden -i '\bused to\b|\bno longer\b|\bpreviously\b|\bthe old\b|\bwas renamed\b|\bwas moved\b' ...
rg -n --hidden -i '\bv1\b|this cut|\bcut \d|\btoday\b|\bfor now\b|roadmap' ...
rg -n --hidden -i 'rejected in review|review round|reviewer|as of v\d' ...
rg -n --hidden -i 'probably |should be enough|should suffice|it simply|is safe —|is safe --' ...
rg -n --hidden '§\d' ...
```

## 中文模式库

```sh
# 中文对应文件中的变更或评审叙述。
rg -n --hidden '评审|上一?轮|旧版|老的|不再|以前|本版|遗留' --glob '*.zh.md' ...

# 英文 Markdown 中的中文写作语残留。
rg -n --hidden '设计稿|评审|上一?轮|旧版|老的|不再|以前|本版|遗留|私有|(^|[^a-zA-Z])端([^a-zA-Z]|$)' --glob '*.md' --glob '!*.zh.md' ...

# 英文代码注释和 JSDoc 中的中文写作语残留。
rg -n --hidden '(^[[:space:]]*(//|/\*|\*)|//|/\*)[^\r\n]*(设计稿|评审|上一?轮|旧版|老的|不再|以前|本版|遗留|私有|端)' --glob '*.{ts,tsx,js,jsx,mjs,cjs,css}' ...
rg -n --hidden '#[^\r\n]*(设计稿|评审|上一?轮|旧版|老的|不再|以前|本版|遗留|私有|端)' --glob '*.py' ...
```

Kongming 层使用时的差异：Kongming 文档整体为简体中文，第一条探针去掉 `--glob '*.zh.md'`、直接作用于全部 Markdown（`third_party/` 已在排除中，不会扫到子模块）；后两条探针主要服务于子模块的英文文件，在 Kongming 层命中预期很少。

## 已知误报族

清理期间判定并保留；预期会再次出现：

- **工具性 "used to"** — "the key used to sign requests" 是工具性的，不是时态。时态形式前面有主语状态（"colors used to come from…"）。
- **运行时旧/新** — "the old connection drains before the new one accepts" 命名交接期间的两个存活对象，不是仓库状态。
- **流程文档里的 "This PR"** — *关于* PR 流程的文档（"the PR body should…"、模板、本仓库的流程说明）合法地说 "PR"；禁令针对文档采纳某个 PR 对代码的视角。
- **作为协议或路径段的 `v1`** — `/v1/chat` 端点和线上格式名称是标识符，不是版本戳。
- **有已提交归属物的 `§N`** — 外部标准（RFC 9110 §10.1.5）和拥有自己 § 编号的已提交文档仍可按小节引用。
- **对比性 "actually" 和名词 "wait"** — 普通英语，不是含糊话；没有已提交行探针它们，所以只有用更宽的含糊模式扩展模式库时才会出现。
- **运行时 "today" 和记录的时间戳** — 询问当前日期的提示词或测试使用自然时间，不是仓库版本戳；记录的 CLI 输出保持其语气。到达模型或用户的文字在改动前仍遵循行为证据规则。
- **zh 正文中的 本版本** — 版本化产物语境中 "this release" 的合法渲染；被禁的索引词是 本版 作为镜像 "this cut" 的光秃戳记。
- **考虑过备选小节** — 笔记体裁槽位内的 "rejected" 是合规归宿，不是评审编排。
