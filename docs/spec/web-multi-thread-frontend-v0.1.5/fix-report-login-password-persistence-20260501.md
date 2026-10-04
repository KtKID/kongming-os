# Web 登录密码持久化修复报告

> 修复时间：2026-05-01 22:07
> 修复人：Claude (x-fix)

## Bug 描述

Web 模块登录后刷新页面会重新掉回密码错误；重置密码后当前会话内可用，退出登录或服务重载后刚才的新密码再次失效。

## 根因分析

根因有两处，且会叠加触发：

1. `src/web/auth/secrets.py` 把 `KONGMING_WEB_PASSWORD` 放在 `password.hash` 之前读取。服务进程重启后，只要环境变量里还保留旧密码，内存里的登录密码就会被旧值重新覆盖。
2. `src/web/routers/auth.py` 的 `reset-password` 固定写 `get_kongming_home()`，没有复用 `create_app()` 当前实际装配的 `app.state.kongming_home`。读取源和写入源可能分叉，导致当前进程内生效、重启后回旧密码。

## 修复方案

1. 调整密码加载优先级为 `password.hash` 优先，`KONGMING_WEB_PASSWORD` 只在缺少文件时做首次引导初始化。
2. `reset-password` 改为写回 `request.app.state.kongming_home`，保证启动读源和重置写源一致。
3. 补充回归测试，覆盖“已有文件忽略残留 env”和“重置密码后重启仍使用新密码”两个场景。

## 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/web/auth/secrets.py` | 调整密码哈希加载优先级，固定 `password.hash` 为长期真源 |
| `src/web/routers/auth.py` | 重置密码时写回 app 当前使用的 `kongming_home` |
| `tests/unit/test_web_auth_secrets.py` | 新增“已有文件优先于残留 env”回归测试 |
| `tests/unit/test_web_routers_auth.py` | 新增“重置后重启仍认新密码”回归测试 |

## 测试验证

本地执行：

```bash
uv run pytest -q tests/unit/test_web_auth_secrets.py tests/unit/test_web_routers_auth.py
```

结果：`24 passed in 6.44s`
