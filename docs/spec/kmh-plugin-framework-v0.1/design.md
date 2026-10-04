# KMH v0.1 实现设计

六项默认及工程约束已确认。代码、测试、脚本与工程配置均位于 packages，规格和任务文档位于 docs/spec。

| 包 | 公开门户与职责 |
|---|---|
| @kmh/runtime | RuntimeManager：真实 Cordis 服务注入、隔离、事件、生命周期和诊断；contracts 为类型真源 |
| @kmh/profile | ProfileManager：YAML/Zod 校验、原子持久化、bundle 选择及配置层完整替换 |
| kmh-base | 必选基础 bundle，业务插件清单为空 |
| @kmh/example | ExampleManager：提供者、消费者、定时资源和事件示例 |
| kmh | CliManager：profile、bundle、config、status、run 命令入口 |
| tooling | 构建、命名及中文注释检查、规格证据索引 |

固定依赖官方 cordis 4.0.0-rc.10；通过公开 Context/plugin/effect/on/isolate 接口复用其插件机制。参考框架的定制行为由 KMH 场景测试核对。

profile 位于 KMH_HOME/profiles/<name>/profile.yml，保存有序 bundle 记录及插件设置。本机覆盖为 KMH_HOME/config.yml。bundle.yml 保存 name/version/plugins；每个插件具有 id/module/export/group/isolated/enabled/config。module 只接收本地文件，构建产物由普通 Node 加载。源码命令通过 tsx ESM 钩子运行。

安装完整检查入口、依赖和配置后，以独占锁及临时文件原子替换更新记录。层次依次为 bundle、profile、本机、本次启动；较后层完整替换目标插件 config，插件 schema 解析默认值与必填项。未知目标和无效内容报告文件及插件。dump 装载元数据且保持 apply 停止。

插件定义为 name/inject/provide/schema/sensitive/apply。分组为声明服务创建独立 Cordis isolate 标签。启动等待所有启用实例活动稳定；加载失败或等待依赖均回收整次启动。明确卸载后经 reload 恢复，依赖者由 Cordis 注入机制停止和重启。

管理操作串行执行。stop 立即停止接收新操作，排空已接收调用，再回收插件效果。清理错误归属插件；超过配置时限返回失败，后台 disposer 继续清理。通知事件独立记录观察者错误；服务调用和顺序交接中的错误返回调用者。

执行顺序：task-foundation（feat01，3 场景）；task-runtime（feat05/06/07/08，20 场景）；task-composition（feat02/03/04，17 场景）；task-acceptance（feat09/10，10 场景）。10 feats 唯一归属，50 场景完整覆盖。先红后绿；高风险行使用真实 Manager、临时目录或构建后 Node 命令。测试来源、差异及各场景证据记录于 packages/tooling/evidence.json。
