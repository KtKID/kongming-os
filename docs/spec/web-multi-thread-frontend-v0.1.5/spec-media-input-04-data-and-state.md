# 数据与状态

## 1. AttachmentAsset

建议新增统一资产模型：

```python
@dataclass(frozen=True)
class AttachmentAsset:
    asset_id: str
    thread_id: str
    kind: Literal["image", "video"]
    mime_type: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None
    sha256: str = ""
    storage_path: str = ""
    preview_url: str = ""
    status: Literal["ready", "processing", "failed"] = "ready"
    created_at: float = 0.0
```

字段语义：

| 字段 | 说明 |
|---|---|
| `asset_id` | 资产主键，供 WS / REST / 历史消息引用 |
| `thread_id` | 归属 thread，做鉴权和 GC |
| `kind` | `image` 或 `video` |
| `preview_url` | 前端缩略图、预览层、历史回显统一读取地址 |
| `status` | `ready / processing / failed` 三态 |

## 2. UserAttachmentRef

建议在 user message 上存引用对象：

```python
class UserAttachmentRef(TypedDict):
    asset_id: str
    kind: Literal["image", "video"]
    mime_type: str
    size_bytes: int
    width: int | None
    height: int | None
    duration_ms: int | None
    preview_url: str
    status: Literal["ready", "processing", "failed"]
```

这份结构进入三个位置：

- `UserInputFrame.attachments[]`
- `HistoryMessageDTO.attachments[]`
- `Message.metadata["attachments"]`

## 3. 协议变化

### WS C2S

```ts
interface UserInputAttachment {
  asset_id: string;
  kind: "image" | "video";
  mime_type: string;
  size_bytes: number;
  width?: number;
  height?: number;
  duration_ms?: number;
  preview_url: string;
  status: "ready" | "processing" | "failed";
}

interface UserInputFrame {
  kind: "user.input";
  text: string;
  request_id: string;
  attachments?: UserInputAttachment[];
}
```

### REST / History DTO

`HistoryMessageDTO` 增加：

```python
attachments: list[dict[str, Any]] | None = None
```

## 4. session 持久化

建议 user message 仍然保持：

```python
Message.user(
    content=text,
    metadata={"attachments": [...]},
)
```

这条路径有三个收益：

- `Message.content` 继续承载文本，兼容现有大量逻辑
- 附件引用持久化进入 JSONL，刷新和重启都能恢复
- Phase 1 先完成图片能力，Phase 2 再把内部模型升级为通用 content parts

## 5. 本地存储布局

```text
.kongming/
└── web/
    └── uploads/
        ├── images/
        │   └── <thread_id>/
        │       ├── <asset_id>.png
        │       └── <asset_id>.json
        └── videos/
            └── <thread_id>/
                ├── <asset_id>.mp4
                ├── <asset_id>.json
                └── jobs/
                    └── <asset_id>.job.json
```

## 6. 状态机

### 图片

`selected -> uploading -> ready -> sent -> replayed`

### 视频

`selected -> uploading -> processing -> ready | failed`

状态解释：

- `selected`：浏览器已选中文件
- `uploading`：文件上传中
- `ready`：资产已可发送、可回显
- `processing`：视频处理链运行中
- `sent`：当前轮 user message 已引用该资产
- `replayed`：历史回放时重新渲染该资产
