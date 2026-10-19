---
description: x-observer 通过独立 headless 调用使用 ZCode 读取已保存的处理图，默认模型、思考档位、调用入口与返回约定。
---

# scene_observer

## 概述

该 profile 让外部观察程序把已保存的 `_mini` 图片交给 KMH 分析。每次 headless 调用使用独立会话，任务文本携带图片绝对路径，由 ZCode 原生 Read 工具读取。默认提供方为 `zcode-cli`、模型为 `glm-5.3-flash`；当前 ZCode 的三档为 `low / high / max`，本 profile 将中间档固定为 `high`。

## 调用与配置

配置由 [cordis.patch.yml](cordis.patch.yml) 和 [package.json](package.json) 承载。调用方使用 KMH 启动器的 `dsh --profile scene_observer`，将本次图片绝对路径与观察要求放入任务文本。完整启动、运行目录与退出契约见 [Headless 外部调用](../../docs/kmh/headless.md)。

配置预检：

```sh
KMH_HOME=/private/tmp/x-observer-scene-observer-kmh node scripts/kmh.mjs dsh --profile scene_observer --dump-config
```

每次任务以一次子进程执行，返回后释放会话。调用方负责保存自己的原图、处理图和每日 JSON；KMH 使用独立的 `KMH_HOME` 保存其运行数据。观察程序先完成图片保存，再将 `_mini` 的绝对路径放入读取要求。

## 图片与结果约定

当前 ZCode 提供方转发文本提示词，原生 CLI 的 Read 工具从提示词中的本地路径读取图片。SDK 的附件入口与当前 ZCode 转发能力分属不同环节；此 profile 使用已经验证的原生文件读取路线。

stdout 携带观察文本，退出码与非空结果共同用于判断调用成功。真实回复可能包含说明文字和代码块；调用方可把完整观察文本作为字符串保存到自己的 JSON 记录中。需要结构化内容时，由调用方提取并校验对应对象。stderr 按 headless 契约持续消费，运行失败由调用方记录错误摘要和相关图片路径。

本机使用官方 ZCode CLI 0.16.9 的图片验证返回了测试图中的随机标记及红色圆形、蓝色方形，原生模型请求包含 `GLM-5.3-Flash`、`reasoning_effort: high` 与图像内容。该结果验证此 profile 的模型图片链路；观察程序的定时截图与每日记录由 x-observer 负责。

## 开发备注

无。
