---
name: obsidian-cli-tester
description: 使用 Obsidian CLI 对插件进行快速即时测试。适用于每次代码修改后的加载、错误、控制台和 DOM 验证。
---

## 概述

本技能用于 Obsidian 插件开发过程中的快速反馈循环。它假设 Obsidian 已在运行且启用了 CLI。

## 核心命令

| 命令 | 作用 |
| :--- | :--- |
| `obsidian plugin:reload id=<插件ID>` | 重新加载插件 |
| `obsidian dev:errors` | 检查 JS 错误 |
| `obsidian dev:console level=error` | 过滤控制台错误 |
| `obsidian dev:dom selector="..."` | 检查 DOM 元素 |
| `obsidian dev:screenshot path=cli-shot.png` | 快速截图 |

## 标准工作流

1. 代码变更后执行 `obsidian plugin:reload id=<插件ID>`
2. 执行 `obsidian dev:errors`
3. 按需执行控制台、DOM 或截图检查
4. 汇总结果并向用户报告

## 示例

（此处放置一个简短的交互示例）