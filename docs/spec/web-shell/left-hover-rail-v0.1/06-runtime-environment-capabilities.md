# 运行环境与能力契约

## 结论

XSpace 桌面包通过 runtime init 声明运行环境，后端把环境和能力归一化到现有客户端配置端点，rail 只读取参数并过滤工具项。当前能力识别走 `POST /api/xspace/runtime/init` 和 `GET /api/config/client`，新增 XSpace 宿主公开 API 只用于运行中宿主控制能力。

## 对接边界

| 参与方 | 角色 | 职责 |
|--------|------|------|
| XSpace 宿主 | 设置者 | sidecar ready/health 成功后调用 `POST /api/xspace/runtime/init`。 |
| Kongming Web 后端 | 读取者 / 归一化者 | 读取启动宿主环境，计算客户端能力，通过 `GET /api/config/client` 下发非敏感运行参数。 |
| Web 前端 | 消费者 | 通过 `useClientConfig()` 读取 `hostEnvironment` 和 `capabilities`。 |
| WebShellRailManager | 展示过滤者 | 根据 `requiredCapability` 过滤 rail item。 |

XSpace 可以读取自己的产品配置用于产品逻辑，但 Web 前端运行在浏览器沙箱内，前端只通过 Kongming Web 后端读取运行时配置。`WebShellCapabilities` 是 Web 前端内部消费类型，XSpace 只需要在启动时提供宿主环境参数。

## 配置与覆盖参数契约

运行环境字段使用独立枚举：

```text
browser | xspace
```

字段名统一为：

```yaml
web:
  host_environment: browser
```

XSpace 桌面包启动后固定调用 runtime init：

```http
POST /api/xspace/runtime/init
X-Requested-With: XMLHttpRequest
Content-Type: application/json

{"host_environment":"xspace"}
```

优先级：

1. `POST /api/xspace/runtime/init`。
2. `--host-environment` 覆盖参数。
3. `KONGMING_WEB_HOST_ENVIRONMENT` 环境变量。
4. 默认值 `browser`。

持久配置默认保持 browser：

```yaml
web:
  host_environment: browser
```

## 客户端配置 DTO

后端继续复用现有客户端配置端点：

```http
GET /api/config/client
```

新增字段：

```json
{
  "host_environment": "xspace",
  "capabilities": {
    "xspace_host": true,
    "native_file_dialog": true
  }
}
```

字段语义：

| 字段 | 类型 | 说明 |
|------|------|------|
| `host_environment` | `"browser" \| "xspace"` | 当前 Web sidecar 的宿主环境。 |
| `capabilities.xspace_host` | `boolean` | 当前实例由 XSpace 桌面宿主启动，可展示 XSpace 专属入口。 |
| `capabilities.native_file_dialog` | `boolean` | 当前环境可通过宿主提供原生文件/目录选择能力。具体调用链由后续宿主能力 task 定义。 |

前端归一化后的结构：

```typescript
type WebHostEnvironment = 'browser' | 'xspace'; // Web sidecar 宿主环境

interface WebShellCapabilities {
  xspaceHost: boolean; // 是否由 XSpace 桌面宿主启动
  nativeFileDialog: boolean; // 是否具备宿主原生文件/目录选择能力
}

interface ClientRuntimeConfig {
  hostEnvironment: WebHostEnvironment; // 当前宿主环境
  capabilities: WebShellCapabilities; // 前端可消费的能力集合
}
```

## Rail item 能力过滤

`WebShellRailItem` 增加可选字段：

```typescript
type WebShellCapabilityKey = keyof WebShellCapabilities; // rail 可声明依赖的能力键

interface WebShellRailItem {
  requiredCapability?: WebShellCapabilityKey; // 声明该入口需要的宿主能力，缺省表示浏览器环境也可用
}
```

`WebShellRailManager` 过滤规则：

1. `available=false` 的 item 隐藏。
2. `requiredCapability` 缺省的 item 按现有规则展示。
3. `requiredCapability` 存在时，只有 `capabilities[requiredCapability] === true` 才展示。
4. mobile / compact 的 density 裁剪继续在能力过滤之后执行。

示例：

```typescript
{
  id: 'native-open-folder',
  scope: 'global',
  priority: 'p1',
  label: '打开目录',
  icon: FolderOpen,
  available: true,
  requiredCapability: 'nativeFileDialog',
  onSelect: openNativeFolder,
}
```

## 公开 API 决策

当前功能不新增给 XSpace 宿主调用的公开 API。XSpace 已经掌握 sidecar 配置和启动权；Web 前端需要的能力信息通过 `GET /api/config/client` 读取。

新增 `/api/xspace/...` 类宿主 API 的触发条件：

- XSpace 需要在 sidecar 启动后动态更新能力。
- XSpace 需要触发后端动作，例如会话 handoff、设备配对、宿主文件桥接。
- 能力调用涉及权限、token、签名或跨进程审计。

`/api/config/client` 是 Web 前端客户端配置端点，继续遵循现有 Web 鉴权和同源策略；它不承担 XSpace 宿主控制面职责。

## 验证要求

- 后端路由测试覆盖 `browser` 默认值、`xspace` 配置值和非法值校验。
- 配置契约测试覆盖 `config/xspace/setting.yaml` 新增字段。
- 前端 hook 测试覆盖 DTO snake_case 到 camelCase 的归一化。
- rail manager 测试覆盖 `requiredCapability` 命中、缺失、compact 裁剪顺序。
- XSpace 对接文档和 sidecar 启动命令保持相同字段名。
