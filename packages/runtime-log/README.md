# runtime-log

Kongming 的 Cordis 日志插件，将已挂载插件产生的日志追加到私有 JSONL 文件。三个 KMH profile 在应用插件树前部加载它；进程输出与启动器自身的记录由 [KMH 启动器](../../docs/kmh/runtime-records.md) 保存。

## 配置与记录

`config.file` 为必填绝对路径。每条 JSONL 保存时间、进程编号、插件名称、日志级别与格式化文本。导出器接收 error、warn、info 和 debug 日志；文件写入同步刷新到磁盘，已有内容保留。目录与新文件分别使用 `0700`、`0600` 权限。

```yaml
- id: runtime-log
  name: "@kmh/runtime-log"
  config:
    file: !!js dshHomePath('logs', 'plugins', `runtime-${process.pid}.jsonl`)
```

插件通过 `ctx.logger.exporter` 注册可释放的导出器。更新或卸载释放旧实例；写入失败释放导出器并向调用方传播原始错误。该插件只写文件，标准输出由运行模式的协议和界面负责。

## 构建与验证

在 Kongming 根目录运行 `pnpm build:kmh`、`pnpm typecheck:kmh`、`pnpm lint`、`pnpm format:check` 和 `pnpm test`。测试验证真实 Cordis 日志导出、更新与卸载、路径拒绝和写入失败，并通过公开 SDK 入口检查日志与协议输出。
