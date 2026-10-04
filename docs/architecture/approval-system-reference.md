核心方案：把 `workshop=目录` 扩展成 `Trust Zone / 信任域`，审批规则绑定在「能力 + 资源范围 + 操作类型 + 时间租约」上。目录只是资源范围的一种，home 常驻 agent 应该走更细的资源域模型。

## 1. 第一性原理：审批控制的本质

Agent 能做的事情分 5 类：

1. **观察**：读文件、读网页、读屏幕、读剪贴板、读邮件。
2. **修改**：写文件、改配置、移动文件、删除文件。
3. **执行**：跑 shell、启动程序、调用脚本、安装依赖。
4. **外发**：发邮件、发消息、上传文件、访问网络 API。
5. **常驻**：定时任务、后台监听、自动整理、长期记忆。

审批模块要回答 7 个问题：

```text
谁在执行？
为了什么任务？
要访问什么资源？
要执行什么能力？
影响范围多大？
能否回滚？
这次授权持续多久？
```

所以审批规则的核心单位应该是：

```text
Permission = Subject + Capability + ResourceScope + Operation + Constraints + Lease
```

其中：

```text
Subject        = agent / sub-agent / thread / workflow
Capability    = fs.read / fs.write / shell.run / app.control / network.send / credential.use
ResourceScope = workshop目录 / home子目录 / app / 系统区 / 外部服务
Operation     = read / create / edit / delete / execute / send / schedule
Constraints   = 文件类型、大小、命令白名单、目标域名、是否允许递归、是否允许隐藏文件
Lease          = 一次 / 本任务 / 本thread / 本workshop / 一段时间 / 持久
```

## 2. 你现在的 workshop 模型适合项目型工作

你现在的设定：

```text
workshop = 一个目录
thread = workshop 内的聊天频道
approval = workshop 级别规则
```

适合这类场景：

```text
~/projects/my-agent/
~/projects/unity-game/
~/repos/x-dev-pipeline/
```

规则可以是：

```text
在 ~/projects/my-agent 内：
- 允许所有 thread 读取全部文件
- 修改文件前展示 diff
- 删除文件每次审批
- shell 命令限制在该目录下执行
```

这个模型的优点是：上下文清晰、风险边界清晰、继承关系清晰。

## 3. home 常驻 agent 要拆成多个 Trust Zone

`home` 目录的爆炸半径太大。它包含代码、照片、聊天记录、密钥、浏览器数据、钱包、配置、缓存、下载、桌面文件。电脑管理 agent 需要一个虚拟 workshop，但权限要分层。

建议定义这些 Trust Zone：

```text
Project Zone        项目目录，例如 ~/Code、~/Projects
Personal Zone       文档、桌面、下载，例如 ~/Documents、~/Desktop、~/Downloads
Media Zone          图片、视频、音乐，例如 ~/Pictures、~/Movies
App Data Zone       应用配置，例如 ~/.config、~/Library/Application Support
Secret Zone         密钥与凭证，例如 ~/.ssh、~/.aws、Keychain、浏览器密码库
System Zone         系统设置、启动项、权限、网络配置
External Zone       邮件、Slack、飞书、GitHub、云盘、浏览器上传
Automation Zone     定时任务、后台任务、常驻监听
```

每个 Zone 有独立默认规则。

推荐默认权限：

| Zone            | 默认策略                    |
| --------------- | ----------------------- |
| Project Zone    | 可读，写入需 diff，执行命令需约束工作目录 |
| Personal Zone   | 目录级授权，批量修改需审批           |
| Media Zone      | 允许索引元数据，读取原文件需审批        |
| App Data Zone   | 读取需说明目的，修改每次审批          |
| Secret Zone     | 每次审批，凭证只允许 broker 代用    |
| System Zone     | 每次审批，必须展示影响说明           |
| External Zone   | 外发前每次审批                 |
| Automation Zone | 创建、修改、删除常驻任务每次审批        |

## 4. 审批模块应该叫 Authority Broker

架构上，Agent 本体不能直接碰文件系统、shell、浏览器、邮件、系统 API。所有能力都经过一个 `Authority Broker`。

```text
Agent Core
   ↓
Tool Router
   ↓
Authority Broker
   ├── Policy Engine
   ├── Resource Classifier
   ├── Approval UI
   ├── Audit Log
   ├── Rollback Manager
   ↓
Tool Adapters
   ├── FileSystem
   ├── Shell
   ├── Browser
   ├── App Controller
   ├── Email / IM
   ├── OS Settings
   └── Credential Vault
```

关键原则：

```text
Agent 负责提出动作。
Broker 负责判断权限。
Adapter 负责执行动作。
Audit Log 负责记录证据。
Rollback Manager 负责回滚。
```

这会让安全边界非常清晰。

## 5. 审批等级设计

建议用 5 档：

```text
AUTO        自动允许
NOTIFY      自动允许，但通知用户
ASK_ONCE    本次询问
ASK_LEASE   授权一段范围和时间
ASK_ALWAYS  每次询问
DENY        拒绝
```

示例：

```text
读取当前项目 src 目录 → AUTO
修改当前项目文件 → ASK_LEASE，展示 diff
删除项目文件 → ASK_ALWAYS
读取 ~/.ssh → ASK_ALWAYS
使用 SSH key → ASK_ALWAYS，由 broker 代用
执行 npm test → AUTO 或 NOTIFY
执行 rm -rf → ASK_ALWAYS 或 DENY
发邮件 → ASK_ALWAYS
创建后台定时任务 → ASK_ALWAYS
```

## 6. 租约模型：解决“同 workshop 所有 thread 共享权限”

你需要把审批结果存成 `Permission Lease`。

```json
{
  "lease_id": "lease_20260429_001",
  "subject": {
    "agent_id": "main-agent",
    "workshop_id": "ws_x_dev_pipeline",
    "thread_scope": "all_threads"
  },
  "capabilities": ["fs.read"],
  "resource_scope": {
    "type": "directory",
    "path": "/Users/kid/Projects/x-dev-pipeline",
    "recursive": true
  },
  "constraints": {
    "include_hidden": false,
    "max_file_size_mb": 20,
    "exclude_patterns": [".env", "*.pem", "node_modules/**", ".git/**"]
  },
  "approval_level": "AUTO",
  "expires_at": "2026-05-29T00:00:00-07:00",
  "created_by": "user",
  "reason": "Allow all threads in this workshop to read project files."
}
```

这能覆盖：

```text
单 thread 授权
所有 thread 授权
单 workshop 授权
某个 agent 授权
某个 workflow 授权
临时授权
长期授权
```

## 7. home 常驻 agent 的正确抽象

给它一个虚拟 workshop：

```text
workshop_id = home-manager
root = ~
mode = persistent
```

但实际权限这样拆：

```text
home-manager:
  metadata.scan:
    scope: ~/Desktop, ~/Downloads, ~/Documents
    approval: NOTIFY

  fs.read:
    scope: 用户明确加入的目录
    approval: ASK_LEASE

  fs.write:
    scope: 用户明确加入的目录
    approval: ASK_ALWAYS 或 ASK_LEASE + diff

  fs.delete:
    scope: 所有目录
    approval: ASK_ALWAYS
    behavior: move_to_trash

  shell.run:
    scope: allowlist commands
    approval: ASK_ALWAYS for unknown command

  credential.use:
    scope: Secret Zone
    approval: ASK_ALWAYS

  external.send:
    scope: email / chat / upload
    approval: ASK_ALWAYS

  automation.create:
    scope: background jobs
    approval: ASK_ALWAYS
```

这样 home agent 可以常驻，但每类动作都有边界。

## 8. 资源敏感度分类器

Broker 每次收到请求，要先给资源打标签。

```text
普通文件：
- .md
- .txt
- .json
- .ts
- .py
- .cs

敏感文件：
- .env
- *.pem
- id_rsa
- config containing token
- browser profile
- keychain
- cookies
- wallet
- ssh config
- cloud credentials
- database dump
- private photo
- mail archive
```

标签示例：

```json
{
  "path": "/Users/kid/.ssh/id_rsa",
  "labels": ["secret", "credential", "private_key"],
  "zone": "SecretZone",
  "sensitivity": "critical"
}
```

敏感度参与最终审批：

```text
最终审批等级 = max(操作风险, 资源敏感度, 外发风险, 持久化风险)
```

## 9. 操作风险评分

建议用一个简单评分模型，先工程可用。

```text
risk = capability_risk
     + resource_sensitivity
     + blast_radius
     + persistence
     + external_exposure
     + irreversibility
```

示例表：

| 行为       | 风险 |
| -------- | -: |
| 读项目文件    |  1 |
| 写单个项目文件  |  2 |
| 批量改项目文件  |  3 |
| 删除文件     |  4 |
| 读密钥      |  5 |
| 使用密钥访问远端 |  5 |
| 修改系统设置   |  5 |
| 发邮件/发消息  |  5 |
| 创建常驻任务   |  5 |

映射：

```text
0-1 → AUTO
2   → NOTIFY / ASK_LEASE
3   → ASK_ONCE
4   → ASK_ALWAYS
5+  → ASK_ALWAYS + 强提示
```

## 10. 审批 UI 要显示“动作证据”

审批弹窗不要只问“是否允许”。要给用户看完整动作证据。

审批卡片字段：

```text
Agent：main-agent
Thread：整理下载目录
目标：把下载目录中的安装包、图片、压缩包分类
能力：fs.write + fs.move
范围：~/Downloads
影响：移动 37 个文件，创建 4 个文件夹
回滚：可一键恢复
持续时间：本次任务
风险：中
```

用户按钮：

```text
允许一次
允许本任务
允许该目录 24 小时
查看 diff / 文件列表
拒绝
编辑规则
```

对于写文件：

```text
必须展示 diff
```

对于移动/删除：

```text
必须展示文件列表
```

对于 shell：

```text
必须展示命令、工作目录、环境变量变更、网络访问可能性
```

对于外发：

```text
必须展示收件人、正文、附件、目标域名
```

## 11. 文件修改必须走事务

Agent 修改电脑文件时，默认流程：

```text
生成计划
↓
生成变更集
↓
展示 diff / 文件列表
↓
用户审批
↓
写入 staging
↓
执行
↓
记录 audit log
↓
可回滚
```

文件删除策略：

```text
删除 = 移入 Trash
永久删除 = 每次审批
```

批量修改策略：

```text
超过 N 个文件 = 升级审批
跨多个目录 = 升级审批
包含敏感文件 = 升级审批
```

## 12. Shell 执行要单独管

Shell 是最高风险能力之一。建议拆成三类：

```text
Safe Commands：
- ls
- pwd
- cat
- grep
- rg
- find with constraints
- git status
- git diff
- npm test
- pytest

Mutable Commands：
- npm install
- pnpm install
- git checkout
- git commit
- mkdir
- mv
- cp
- chmod

Dangerous Commands：
- rm
- sudo
- curl | sh
- chmod -R
- chown -R
- launchctl
- crontab
- systemctl
- security
- osascript controlling apps
```

执行规则：

```text
Safe Commands → 项目目录内可自动
Mutable Commands → 展示命令后审批
Dangerous Commands → 每次审批
sudo → 每次审批
curl | sh → 默认强提示
```

## 13. 外发能力是独立高危能力

读文件和发文件组合后风险会变高。

例如：

```text
读取 ~/Documents/resume.pdf
上传到 unknown-domain.com
```

这个动作由两个低层能力组成：

```text
fs.read + network.upload
```

最终要按外发审批处理。

外发类能力包括：

```text
email.send
chat.send
http.upload
browser.form_submit
github.push
cloud.sync
clipboard.write
```

审批必须展示：

```text
目标对象
发送内容
附件
目标域名
是否包含敏感标签
```

## 14. 常驻 agent 要加“时间边界”

常驻 agent 最大风险是持续行动。它的权限要区分：

```text
one_shot       本次动作
task_scoped    当前任务
thread_scoped  当前 thread
workshop_scoped 当前 workshop
time_scoped    例如 24 小时
persistent     长期
```

持久授权只适合低风险能力：

```text
允许读取项目目录
允许监听某个目录变化
允许记录任务状态
允许提醒用户
```

持久授权慎用在这些能力上：

```text
写 home 文件
执行 shell
访问凭证
发送消息
创建后台任务
修改系统设置
```

## 15. 最小可用规则模型

你可以先做这 6 张表：

```text
agents
workshops
threads
trust_zones
permission_leases
audit_events
```

核心表：

```sql
CREATE TABLE permission_leases (
  id TEXT PRIMARY KEY,
  subject_type TEXT,          -- agent/thread/workshop/workflow
  subject_id TEXT,
  capability TEXT,            -- fs.read/fs.write/shell.run/...
  resource_type TEXT,         -- directory/file/app/domain/credential/system
  resource_pattern TEXT,
  constraints_json TEXT,
  approval_level TEXT,        -- AUTO/NOTIFY/ASK_ONCE/ASK_LEASE/ASK_ALWAYS/DENY
  inherit_to_threads INTEGER,
  expires_at TEXT,
  created_at TEXT,
  reason TEXT
);
```

审计表：

```sql
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  thread_id TEXT,
  workshop_id TEXT,
  capability TEXT,
  resource TEXT,
  action TEXT,
  decision TEXT,
  risk_score INTEGER,
  diff_ref TEXT,
  rollback_ref TEXT,
  created_at TEXT
);
```

## 16. Policy Engine 伪代码

```ts
type Capability =
  | "fs.read"
  | "fs.write"
  | "fs.delete"
  | "shell.run"
  | "app.control"
  | "network.request"
  | "external.send"
  | "credential.use"
  | "automation.create";

type ApprovalLevel =
  | "AUTO"
  | "NOTIFY"
  | "ASK_ONCE"
  | "ASK_LEASE"
  | "ASK_ALWAYS"
  | "DENY";

interface ActionRequest {
  agentId: string;
  workshopId?: string;
  threadId?: string;
  capability: Capability;
  resource: string;
  operation: string;
  reason: string;
  payload?: unknown;
}

interface PolicyDecision {
  level: ApprovalLevel;
  reason: string;
  requireDiff: boolean;
  requireRollback: boolean;
  matchedLeases: string[];
  riskScore: number;
}

function decide(req: ActionRequest): PolicyDecision {
  const resourceLabels = classifyResource(req.resource);
  const leases = findMatchingLeases(req);
  const capabilityRisk = scoreCapability(req.capability, req.operation);
  const resourceRisk = scoreResource(resourceLabels);
  const blastRadius = scoreBlastRadius(req);
  const persistenceRisk = scorePersistence(req);
  const externalRisk = scoreExternalExposure(req);

  const riskScore =
    capabilityRisk +
    resourceRisk +
    blastRadius +
    persistenceRisk +
    externalRisk;

  const leaseDecision = resolveLeases(leases);

  const riskDecision = mapRiskToApprovalLevel(riskScore);

  const level = stricter(leaseDecision.level, riskDecision);

  return {
    level,
    reason: buildReason(req, resourceLabels, riskScore),
    requireDiff: req.capability === "fs.write",
    requireRollback: ["fs.write", "fs.delete", "shell.run"].includes(req.capability),
    matchedLeases: leases.map(x => x.id),
    riskScore
  };
}
```

## 17. 对你这个产品的推荐设计

你的审批系统可以分三层：

```text
Layer 1：Workshop Policy
面向项目开发，继承到 thread，适合代码目录。

Layer 2：Trust Zone Policy
面向电脑管理，把 home 拆成 Project / Personal / Secret / System / External / Automation。

Layer 3：Action Broker
所有工具调用统一过 broker，按能力、资源、操作、时间租约做最终判断。
```

默认规则：

```text
项目目录：
- 允许读
- 写入展示 diff
- 删除每次审批
- shell 限制在项目目录

home-manager：
- 允许索引 Desktop / Downloads / Documents 的文件名和基础元数据
- 读取文件内容按目录授权
- 修改文件展示计划和 diff
- 删除移动到 Trash
- Secret Zone 每次审批
- System Zone 每次审批
- 外发每次审批
- 创建常驻任务每次审批
```

## 18. 最关键的产品判断

你的审批模块要做成「可解释的授权系统」。用户看到的不是底层权限细节，而是：

```text
这个 agent 想做什么
它要碰哪里
它会改什么
这次授权持续多久
之后同类动作是否自动通过
出了问题怎么回滚
```

最终推荐架构：

```text
Workshop = 协作与上下文单位
Trust Zone = 资源安全边界
Permission Lease = 审批结果
Authority Broker = 强制执行点
Audit Log = 责任链
Rollback = 安全感
```

先实现 `Workshop Policy + Permission Lease + File/Shell Broker`，再扩展到 `Home Trust Zone`。这条路线最稳，能让你的 agent 从一开始就具备比普通 agent 更强的安全感和工程可信度。
