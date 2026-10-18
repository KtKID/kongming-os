# x-music 服务插件 调查记录

2026-10-18 为 [x-music 服务插件 v0.1 规格](spec.md)做形态分析时的只读调查。记录 [kmh-plugin-guide](../../../.agents/skills/kmh-plugin-guide/SKILL.md) 要求的两个判断的结论与证据、端口角色边界、配置项清单（含来源）、助手工具接入建议、生效与验证入口、已知限制与未做项。全程未改动 `packages/`、`profiles/`、`bundles/`、`third_party/dsh`，未启停任何服务。规格定稿后，技术设计以本记录为事实来源，不再重复调查。

## 1. 判断一：助手工具要不要写进插件

**结论：不写进插件。** x-music 的 MCP 服务是一个独立常驻的 Streamable HTTP 服务，接入不需要运行期取值（无凭据、无环境变量、不需要 DSH 拉起进程、地址固定），满足指南"直接在 profile 的 `cordis.patch.yml` 声明一个 `@deepseek-ai/dsh-mcp-client` 实例"的零代码条件。代价（无页面开关、不随插件启停、改地址需编辑 YAML 并重启）已写入规格待确认 1，由用户取舍。

### 证据

| 事实 | 证据 |
|---|---|
| 本机 ZCode 以 HTTP 传输注册 x-music，无 command/args/env | `~/.zcode/cli/config.json` → `mcp.servers["x-music"]` = `{"type": "http", "url": "http://127.0.0.1:3001/mcp"}`（python3 读取 JSON 输出） |
| 传输为 Streamable HTTP（无状态），端口变量 `XMCP_PORT`（默认 3001）、监听变量 `XMCP_HOST`（默认 0.0.0.0），**无访问令牌** | `/Users/kid/.agents/skills/x-music-mcp/SKILL.md` 第 8、12-13、110 行；`/Volumes/machub_app/proj/x-music/docs/mcp-access.md`"前提"节与 ⚠️ 提示 |
| 实际 `.env` 未设 `XMCP_*`，MCP 走默认值 | `grep -E "^(XMCP_HOST\|XMCP_PORT)=" /Volumes/machub_app/proj/x-music/.env` 无输出；`lsof` 显示 `*:3001` |
| 服务由 x-music 的 `xm start` 与另外三个部件一起拉起，不依赖接入方 | `mcp-access.md`"启动 x-music 四件套"；`lsof -nP -iTCP:3001 -sTCP:LISTEN` → `node 45258 kid *:3001`；`ps -p 45258` → `/opt/homebrew/Cellar/node/25.6.1_1/bin/node --require .../x-music/node_modules/.pnpm/tsx@4.23.15/.../preflight.cjs ...` |
| 匿名 POST 即可列出工具，实际 **12 个**（技能文档写 10 个已过时） | `curl -s http://127.0.0.1:3001/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` → `xmusic_ingest, xmusic_ingest_prune, xmusic_status, xmusic_search, xmusic_history, xmusic_track_stats, xmusic_play, xmusic_next, xmusic_pause, xmusic_resume, xmusic_stop, xmusic_replay` |
| DSH 的 mcp-client 支持 `transport: streamable-http`，字段为 `serverName / url / headers / toolCallTimeoutMs / failOnStartupError / maxInstructionBytes / reconnect` | `third_party/dsh/packages/mcp/mcp-client/README.zh.md` 第 45-67 行；`src/index.ts` 第 133-138 行 |
| mcp-client **没有按工具过滤**的配置，12 个工具只能整体接入 | 同上 `src/index.ts` 两种 transport 的 schema 字段中无 allow/deny/include/exclude |
| `serverName` 允许连字符，`x-music` 不触发有损改名 | `src/index.ts:40` `SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/`；`src/tools.ts:50-56` 公开名只许 `[A-Za-z0-9_-]`、上限 64 字符；最长工具名 `mcp__x-music__xmusic_ingest_prune` 为 33 字符 |
| `serverName` 现有占用：`mademe`（kmh-web、kmh-mobile-assistant 两个 profile）、`openviking`（bundles/dsh-web）、`infra`（kmh-infra 编程式）；`x-music` 与 `xmusic` 均未占用 | `grep -rn serverName profiles bundles packages`（排除 node_modules/lib/test） |
| Streamable HTTP 的重连归属在 DSH 侧**尚未决定** | `mcp-client/README.zh.md` 第 225 行（维护者工作上下文）："Streamable HTTP 的重连归属仍未决定：按请求重试是 SDK 行为，supervisor 也可以拥有 HTTP 世代" |
| 初次连接失败不阻塞启动，但工具不出现 | 同 README 第 71 行；`failOnStartupError` 默认 false |

### 接入草案（供技术设计采用，未写入任何文件）

```yaml
    - id: mcp-xmusic
      name: '@deepseek-ai/dsh-mcp-client'
      # x-music 播放与收听记录工具（mcp__x-music__<tool>）：x-music 四件套之一的
      # Streamable HTTP 服务，由 x-music 自己的 `xm start` 常驻，DSH 只连接不拉起。
      # 无凭据、无环境变量；改端口（x-music .env 的 XMCP_PORT）或停用时直接编辑本条目后重启 Web。
      config:
        serverName: x-music
        transport: streamable-http
        url: http://127.0.0.1:3001/mcp
```

落点与 `mcp-mademe` 同一处：`profiles/kmh-web/cordis.patch.yml` 的 `- insert:` 列表（现第 44-53 行为 `mcp-mademe`）。实例说明写进 `profiles/kmh-web/README.md`（现有"MadeMe 工具"一节为范本）。若用户选备选路线（插件内装配），参照 `packages/kmh-infra/src/mcp.ts`，并把 `mcpUrl`、`mcpEnabled` 加进配置项。

## 2. 判断二：Web 端能否内嵌

**结论：响应头层面可内嵌，服务当前在运行。** 60070 返回 `200 text/html`，响应头无 `X-Frame-Options`、无 `Content-Security-Policy`，HTML 正文无 `<meta http-equiv="Content-Security-Policy">`。指南要求的"普通浏览器 `<iframe src>` 实测"本轮未做（任务限定只读调查），列为实现阶段第一项验证。

### 证据

`curl -sI --max-time 5 http://127.0.0.1:60070/` 完整响应头：

```
HTTP/1.1 200 OK
Vary: Origin
Content-Type: text/html
Cache-Control: no-cache
Etag: W/"17c-3HWHrEaAqvW0m2Ox2o8tlDEQLPw"
Date: Sun, 18 Oct 2026 04:23:48 GMT
Connection: keep-alive
Keep-Alive: timeout=5
```

`curl -s http://127.0.0.1:60070/` 正文（节选）：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <script type="module" src="/@vite/client"></script>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>x-music Dashboard</title>
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="/src/main.ts?t=1791478586429"></script>
  </body>
</html>
```

| 事实 | 证据 |
|---|---|
| 60070 由 vite 开发服务器提供（非生产静态托管） | 正文含 `/@vite/client`；`lsof` → `node 45224 kid *:60070`；`ps -p 45224` → `node /Volumes/machub_app/proj/x-music/node_modules/.bin/../vite/bin/vite.js` |
| 页面是"浏览器管理面板 + 播放端"，用 `<audio>` 出声，并作为设备注册、心跳、轮询命令 | `x-music/README.md` 第 94 行"`src/client/web` 浏览器播放端（Web Receiver）"；`src/client/web/src/main.ts` 第 1-6 行模块注释："浏览器管理面板(搜索点播 + 听歌数据)与播放端。复用共享 device-client(注册/心跳/点播/命令轮询)…音频直连 streamUrl,不过 music-core" |
| 页面自带自动播放被拦的处理 | `src/client/web/src/audio-engine.ts` 第 62-68 行捕获 `NotAllowedError` 置 `autoplayBlocked`；`main.ts` 第 228 行提示文案"浏览器阻止了自动播放,点击页面任意位置解锁声音"，第 721-729 行任意点击解锁重试 |
| 页面对 music-core 与手机网关的请求走 60070 **同源代理**，KMH 只需面板一处地址 | `src/client/web/vite.config.ts`：`server.proxy['/api'] → http://${XMUSIC_HOST}:${XMUSIC_PORT}`、`['/gateway'] → http://<gateway>:${XMUSIC_GATEWAY_PORT}`；`server.host = WEB_RECEIVER_HOST`、`server.port = WEB_RECEIVER_PORT` |
| 音频流直连 Navidrome 的局域网地址（http） | `x-music/.env.example` `NAVIDROME_BASE_URL=http://192.168.110.242:4533`；KMH Web 为 http://localhost:60000，不构成混合内容 |

### 内嵌相关风险

- **自动播放许可**：现有三个服务插件的面板 iframe 属性（指南第 6 步：`sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"`）不含 `allow="autoplay"`。跨源 iframe 默认不继承父页的自动播放许可：用户在面板内点击播放没问题；被手机等其他端推送起播时第一次会被拦，页面自己提示点击解锁。面板切走即卸载、切回重载，解锁状态随之丢失。是否给面板加自动播放许可是规格待确认 6。
- **托管方式变化**：当前头部由 vite dev server 发出；x-music 若改为生产构建 + 其他静态服务器托管，响应头需复测。

## 3. 端口角色与边界

| 端口 | 环境变量（x-music `.env.example`） | 实际监听 | 角色 | `/` 响应 | 与本插件的关系 |
|---|---|---|---|---|---|
| 60070 | `WEB_RECEIVER_PORT` / `WEB_RECEIVER_HOST=0.0.0.0` | `*:60070`（vite） | Web 端：管理面板 + 浏览器播放端 | `200 text/html`，无 XFO/CSP | **面板内嵌目标**（配置项 `boardUrl`） |
| 3000 | `XMUSIC_PORT` / `XMUSIC_HOST=127.0.0.1` | `127.0.0.1:3000`（tsx） | music-core：核心 JSON 接口 | `404 application/json` | 不直接访问；面板页经 `/api` 代理到它 |
| 60073 | `XMUSIC_GATEWAY_PORT` / `XMUSIC_GATEWAY_HOST=0.0.0.0` | `*:60073`（tsx） | 手机网关（HarmonyOS 客户端接入） | `404 application/json` | 不直接访问；面板页经 `/gateway` 代理到它 |
| 3001 | `XMCP_PORT` / `XMCP_HOST=0.0.0.0`（`.env` 未设，走默认） | `*:3001`（tsx） | MCP 工具服务（Streamable HTTP） | `404 application/json`（端点在 `/mcp`） | **助手工具接入目标**（YAML 实例 `url`） |
| 4533 | `NAVIDROME_PORT` | 未探测 | Navidrome 曲库（音频流来源） | — | 面板页直连拉流，KMH 不涉及 |
| 60000 | — | — | Kongming Web（`profiles/kmh-web`） | — | 与上述端口无冲突 |

四个 x-music 进程（PID 45195、45224、45258、45289）命令行均位于 `/Volumes/machub_app/proj/x-music`，属用户 `kid`，PID 连续，与"`xm start` 一次拉起四件套"一致。60070、3001、60073 监听 `0.0.0.0` 且无访问令牌，是 x-music 侧的安全立场（其文档已提示"只在受信网络使用"）；KMH 侧默认只连 `127.0.0.1`，不改变这一立场。

## 4. 配置项清单

按指南第 1 步逐条列出。"来源"区分用户给定（端口表、本次需求）与本轮提议；提议项在规格里全部放在待确认清单，不当作已定需求。v1 默认只含前两项。

| 名字（camelCase） | 类型 | 默认值 | 表单呈现 | 来源 | 进 v1 |
|---|---|---|---|---|---|
| `boardUrl` | string（http(s) 地址） | `http://127.0.0.1:60070` | 地址框，非法地址阻塞保存并内联提示 | **用户**：端口表"Web 端（Board，面板目标）60070"（2026-10-18） | 是 |
| `panelLoadTimeoutMs` | number（毫秒，正整数） | `8000` | 正整数框 | **用户**：需求"8 秒超时提示"（2026-10-18）；按配置项而非写死，是提议 C | 是 |
| `probeTimeoutMs` + "测试连接" | number（毫秒，正整数） | `5000` | 正整数框 + 探测按钮 | **提议**（MadeMe、Infra 有；Token 分析按剃刀法则删除）；规格待确认 4 | 默认否 |
| `mcpEnabled` | boolean | `true` | 开关行 | **提议**，仅在用户选"插件内装配"路线时才存在；规格待确认 1 | 默认否 |
| `mcpUrl` | string（http(s) 地址） | `http://127.0.0.1:3001/mcp` | 地址框 | 同上，仅编程装配路线；YAML 路线下此值写在 profile 实例 | 默认否 |

不设的项与理由：music-core（3000）、手机网关（60073）地址——面板页自己代理，KMH 不直接访问（规格 C1）；x-music 凭据——服务无令牌；工作目录、命令路径——DSH 不拉起 x-music 进程。

## 5. 助手工具接入方式与 serverName 建议

- **方式**：profile YAML 直接声明 `@deepseek-ai/dsh-mcp-client` 实例（第 1 节草案），零代码，与 `mcp-mademe` 同路。
- **serverName 建议 `x-music`**：与本机 ZCode（`~/.zcode/cli/config.json`）、Claude Code、Claude Desktop、Codex 的注册名一致（见 `x-music-mcp/SKILL.md` 各客户端示例），工具名 `mcp__x-music__xmusic_*` 与用户在 ZCode 里已经熟悉的一致，为 ZCode 写的用法与规则可原样搬入 KMH persona。备选 `xmusic`（`mcp__xmusic__xmusic_*`）。两者均未被占用（第 1 节证据表）。
- **工具数**：12 个整体接入（无过滤能力）。含 `xmusic_ingest`、`xmusic_ingest_prune` 两个 NAS 入库工具；后者的删除需 `confirm_deletion=true` 二次调用（本机已注册的工具描述），由 x-music 侧兜底。
- **声音归属**：`xmusic_play` 出声走 Mac 本机 mpv 引擎（`x-music-mcp/SKILL.md` 第 8 行"声音从 Mac 出"、排障表"浏览器播放页与 Agent 同时出声…互不干涉"），与面板里的 Web 端是两个播放端。

## 6. 生效与验证入口（实现阶段，按指南第 8-10 步）

- 插件：`pnpm --filter @kmh/xmusic build && pnpm --filter @kmh/xmusic typecheck`、`lint`、`format:check`、`node --test packages/kmh-xmusic/test/*.test.mjs`；`pnpm config:web | grep -n -A8 "id: kmh-xmusic"` 核对合成配置；`./kmh.sh restart`（schema 默认值不热推）。
- 面板：真实浏览器——侧栏出现入口；点开加载到 `x-music Dashboard`；**先做一次 `<iframe src="http://127.0.0.1:60070/">` 实测**（本轮未做）；停掉 x-music 后约 8 秒出提示、"在系统浏览器打开"可用；改地址保存后面板按新值重载；在面板内点播能出声；由其他端推送起播时观察自动播放拦截与解锁提示。
- 助手工具：`pnpm config:web | grep -n -A8 "id: mcp-xmusic"`；重启后设置 → Built-in plugins → Global plugins 搜 `mcp`，`mcp-xmusic` Status 为 Running；`$KMH_HOME/logs/web-supervisor/web-server.log` 看连接与工具同步行；**新建会话**让助手调用 `xmusic_status`；停掉 x-music 再调用，确认助手如实转述"未运行"。
- 实例级机器检查：包测试里用 `loadOverlayPatches`（`third_party/dsh/packages/boot/app-boot/lib/index.js`）断言实例存在、`transport: streamable-http`、`serverName` 唯一（参考 `packages/kmh-mademe/test/mademe-smoke.test.mjs`）。
- 配置变更按 AGENTS.md 跑完整 `pnpm test`。

## 7. 已知限制与风险

1. YAML 路线：工具无页面开关、不随插件启停、改地址需编辑 profile 并重启 Web。
2. 启动顺序：x-music 需先于 KMH Web 启动；KMH 先起时工具不出现，HTTP 传输的自动重连归属在 DSH 侧未定，稳妥做法是重启 Web。
3. Codex CLI 后端：工具仅新建会话可见（指南第 9 步）。
4. 无按工具过滤：入库工具（含确认后删除）一并暴露给助手。
5. 面板切走即卸载：面板内播放中断；自动播放许可默认不授予。
6. 60070 由 vite dev server 托管：托管方式变化需复测响应头。
7. `mcp-resources`：若 x-music 不提供 resources，精简工具的 profile 需按指南第 9 步评估是否关闭（kmh-web 已接 mademe/openviking，本项不新增影响）。

## 8. 未做与受阻项

- 未用真实浏览器做 `<iframe>` 实测（任务限定只读调查）；结论基于响应头与正文。
- 未验证 DSH mcp-client 对该服务的完整握手（initialize → tools/list）；仅验证了匿名 `tools/list` 可用。实现阶段以实例 Running 状态为准。
- 未改 `docs/spec/README.md` 索引、`docs/kmh/plugin-index.md`、`profiles/kmh-web/README.md`（任务限定），规格确认后随实现补齐。（注：`docs/spec/README.md` 索引已于 2026-10-18 由主会话补登。）
- 未探测 4533（Navidrome）；与本插件无直接关系。

## 9. 出声路径与设备定向（2026-10-18 第二轮，对应待确认 7）

问题：助手点播的声音从哪个方向出、"让声音从 KMH 面板的 Board 出"与"维持 Mac 本机出声"工作量差别多大。证据均在 `/Volumes/machub_app/proj/x-music`。

**现状（A，Mac 本机出声，零工作）。** MCP 服务进程自己就是一台播放设备：启动即以 `deviceId=mcp-<主机名>` 向 music-core 注册会话，1s 心跳 + 500ms 轮询（`apps/mcp-server/src/playback.ts:294-328,419-430`）。`xmusic_play` 把点播命令投进**自己的**会话（`POST /sessions/{自己}/agent-play`，`playback.ts:446-450`；服务端入队 `apps/music-core/src/play-session/routes.ts:282-306`），轮询领到命令后由懒启动的 **mpv** 播放（`packages/mpv-engine/src/index.ts:48-57`）。音频数据不经 music-core：streamUrl 是源站直链（Navidrome `/rest/stream.view` 直链 `packages/navidrome-adapter/src/track.ts:238-239`；网易云 CDN mp3 直链、时效约 25 分钟 `packages/ncm-adapter/src/source.ts:366-397`）。mpv 未设 `--audio-device`，走 macOS 系统默认输出口；换输出口的既有旋钮是 MCP 配置 `XMUSIC_MPV_ARGS`（如 `--audio-device=coreaudio/<设备>`，`apps/mcp-server/src/config.ts:19-20`，`.env.example` 未记载）。点网易云歌时 ncm-cli 的守护 mpv 会先出 <1s 解析杂音（`ncm-adapter/src/source.ts:6-8`），与目标设备无关。

**Board 是同一设备抽象下的另一台设备。** 抽象 = `PlayerEngine`（mpv/`<audio>`/原生）+ `DeviceClient`（注册/心跳/轮询）+ `PlaybackController` 共享状态机（`packages/device-client/src/engine.ts:2-4`、`playback-controller.ts:52`）。Board 打开即注册 `deviceId=web-<8hex>`（localStorage 持久），轮询拿 `{action:'play', track, streamUrl}` 后 `<audio>` 直连同一 streamUrl 出声（`src/client/web/src/main.ts:303-320,610-666`、`audio-engine.ts:33-57`；协议 `packages/protocol/src/device.ts:86-92`）。手机**不是**第三个轮询设备：60073 网关是白名单代理、不含 `/sessions/*`（`apps/client-gateway/src/core-proxy.ts:60-129`），手机走 `/playback-resources` 直链 + 原生 AVPlayer（`apps/music-core/src/playback-resource/routes.ts`）。

**定向能力：服务端有、工具入口没有。** `agent-play` 的目标会话在 URL 路径里，天然可投给 Board（x-music 的 web-receiver 规格 feat05 即此意图，`docs/spec/web-receiver/spec.md:143-170`）；但全仓只有 MCP 调用且恒投自己（grep 仅 `playback.ts:402,448`），`xmusic_play` 入参只有 `queries`（`apps/mcp-server/src/tools/playback.ts:12-20`），且没有接口暴露其他会话的 sessionId（`/health` 设备列表不含，`apps/music-core/src/index.ts:126-130`）。补齐属 x-music 侧"中改"：`/health` 加 sessionId（小改）+ `xmusic_play` 加设备参数并把起播确认/顺播队列/停止远程化（`playback.ts` 约 570 行核心逻辑，一天级含测试）；远程**暂停/继续**协议无法表达（`DeviceCommandSchema` 仅 play/stop，`protocol/src/device.ts:87-90`），要支持还需扩协议。

**结论。** A 零工作；B（声音从 KMH 面板的 Board 出）今天做不到、需 x-music 侧中改，**KMH 插件侧零改动**，行为特征同待确认 6（面板开着设备才在线、切走即断、首次远程起播需点击解锁）；C（KMH 自做接收端）等于重写 Web Receiver，不值。推荐按 A 关闭待确认 7；将来做 B 只是 x-music 一天级工作，不进本规格范围。顺手项：x-music 的 `.env.example` 补记 `XMUSIC_MPV_ARGS`。
