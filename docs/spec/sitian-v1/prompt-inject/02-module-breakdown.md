# 组件设计

## 组件总览

| 组件 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| sitian_context 纯函数 | 读 workspace_state + 格式化文本 | 无（stdlib only） | 可进入 x-req | 新增文件 |
| assemble_instructions 扩展 | 公共函数加 sitian_root 参数 | sitian_context | 可进入 x-req | 改已有文件 |
| CLI/Web 装配适配 | 调用方解析 sitian_root 并传入 | assemble_instructions | 可进入 x-req | 改已有文件 |

## 组件详情

### 组件 1：sitian_context 纯函数

**职责**：读 workspace_state.json，格式化为 system prompt 可消费的文本。

**包含范围**：
- 读 `workspace_state.json`（JSON 解析）
- 读 `latest_summary.md`（可选，存在则追加）
- 读 `latest_analysis.md`（可选，存在则追加为独立分析段）
- 格式化 work_items 列表（title + status + priority + lastModifiedAt + nextAction）
- 格式化 blockers + risks 段
- 生成 freshness 时间戳
- work_items 超过 MAX_ITEMS 时截断

**不包含范围**：
- 不 import sitian 包的任何模块
- 不读 observations.jsonl（太大）
- 不读 config（不知道 output_subdir，由调用方解析后传 sitian_root）
- 不做 LLM 调用

**依赖**：无（stdlib json + pathlib + datetime）

**文件位置**：`src/context/sitian_context.py`

**接口**：

```python
def build_sitian_context_text(sitian_root: Path) -> str | None:
    """从 sitian_root 读 workspace_state.json，格式化为 system prompt 文本。

    Args:
        sitian_root: SiTianRecords 产物目录（已含 output_subdir）。
            调用方负责从 config 解析出完整路径。

    Returns:
        格式化文本，或 None（文件不存在 / 解析失败 / work_items 为空）。
    """
```

**输出格式示例**：

```markdown
## 工作区态势（司天观察）

数据采集于 2026-05-10T12:00:00Z

| # | 项目 | 状态 | 优先级 | 最近活跃 | 下一步 |
|---|------|------|--------|---------|--------|
| 1 | kongming-agent | active | low | 10 分钟前 | 查看最新线程并决定下一步 |
| 2 | x-memo | active | low | 2 小时前 | 补充最近进展 |
| 3 | x-infra | waiting | medium | 1 天前 | 检查是否有阻塞 |

### 阻塞项
- x-build: 扫描路径不存在

### 风险项
- ralph: 最近缺少新活动（5 天前）
```

**复用/新建**：全新开发。参考 `src/context/runtime_context.py` 的纯函数设计模式。

**风险等级**：低
**风险说明**：读 JSON + 格式化文本，无技术风险。

**task 建议**：
- 建议 task 名：`sitian-prompt-inject`
- 对应 DoD：#1 #2 #3 #5
- 是否进入 x-req：是
- 原因：接口明确，独立可测

### 组件 2：assemble_instructions 扩展

**职责**：在公共 `assemble_instructions()` 函数中注入 sitian context。

**包含范围**：
- 函数签名新增 `sitian_root: Path | None = None` 参数
- sitian_root 非 None 时调 `build_sitian_context_text(sitian_root)`
- 返回值非 None 时追加 `InstructionSource(origin="sitian", content=text)`
- 插入位置：runtime context 之后、InstructionLoader 的 sources 之后（append，不 insert）

**不包含范围**：
- 不改 InstructionLoader 类本身
- 不改 render() 逻辑
- 不新增 Protocol

**依赖**：sitian_context

**文件位置**：`src/context/instruction_loader.py`（改已有函数）

**改动点**：

```python
async def assemble_instructions(
    *,
    kongming_home: Path,
    extra_files: Sequence[str | Path] = (),
    cwd: Path | None = None,
    sitian_root: Path | None = None,      # ← 新增
) -> tuple[str, list[str]]:
    ...
    # 现有代码不变
    ...
    # 在 sources.insert(0, runtime) 之后追加：
    if sitian_root is not None:
        from .sitian_context import build_sitian_context_text
        sitian_text = build_sitian_context_text(sitian_root)
        if sitian_text:
            sources.append(InstructionSource(origin="sitian", content=sitian_text))

    rendered = loader.render(sources)
    ...
```

**复用/新建**：改已有函数，加 3-5 行。

**风险等级**：低
**风险说明**：只加可选参数，默认 None 不影响现有调用方。

**task 建议**：
- 建议 task 名：`sitian-prompt-inject`（与组件 1 合并）
- 对应 DoD：#1 #4
- 是否进入 x-req：是

### 组件 3：CLI/Web 装配适配

**职责**：在 CLI 和 Web 装配层解析 sitian_root 路径并传给 `assemble_instructions()`。

**包含范围**：
- CLI：`src/cli/main.py` 的 `_assemble_instructions()` 解析 `cfg.sitian.output_subdir` → 拼 sitian_root → 传入
- Web：找到 Web 的 instructions 装配入口，同样传入

**不包含范围**：
- 不改 config_loader（不加新 config 字段）
- 不加 CLI 命令行参数（自动从已有 config 推导）

**依赖**：assemble_instructions 扩展

**路径解析逻辑**（CLI 和 Web 共用）：

```python
def _resolve_sitian_prompt_root(cfg: Config) -> Path | None:
    """解析 sitian 产物目录，供 prompt 注入使用。

    复用 sitian.store.resolve_sitian_root 的默认路径逻辑
    （~/.kongming/SiTian），再拼 output_subdir。
    """
    from sitian.store import resolve_sitian_root
    base = resolve_sitian_root()  # ~/.kongming/SiTian
    if cfg.sitian.output_subdir:
        return base / cfg.sitian.output_subdir
    return base
```

**复用/新建**：改已有装配函数，加 3-5 行。复用 `resolve_sitian_root()`。

**风险等级**：低

**task 建议**：
- 建议 task 名：`sitian-prompt-inject`（与组件 1、2 合并）
- 对应 DoD：#4
- 是否进入 x-req：是
