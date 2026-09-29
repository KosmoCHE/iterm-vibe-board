# iterm-vibing-board

住在 iTerm2 侧栏里的待办本，以人为中心，你和每个 pane 里跑着的 AI coding agent 一起维护。

> **状态：pre-alpha。**还什么都不能用。设计已定，代码在写。

[English](README.md)

## 为什么

同时开好几个 Claude Code 会话时，iTerm2 自带的 Session Status 能告诉你哪个 pane 在跑、在等、闲着。它回答不了的是：

- **我**要做什么，每件事是哪个 pane 在推？
- 哪些是原计划里的，哪些是半路冒出来的（突发问题、临时想法、别的会话移交过来的）？
- 现在有哪些事在等我？

agent 那一侧的任务清单（Claude Code 自带的 `TaskCreate`，以及大多数「agent 看板」工具）都是从 agent 的角度回答：折叠在对话里、你改不了、一个 agent 一份。这个看板反过来：事是你的，agent 只是在推的人。

## 做什么

- **一个面板三页**，在 iTerm2 侧栏（View › Toolbelt）：Global（跨项目的事）、Workspace（聚焦 pane 所在项目的事，按 Claude Code 启动目录算）、Session（同一批事里，聚焦 pane 的会话在推的）。后两页跟着你点进的 pane 切换。
- **每件事记**：栏目（等我 / 进行中 / 等别人 / 以后 / 完成）、谁在推、来源（原计划 / 突发 / 插入）、谁建的、子步骤、依赖（可跨项目）、下一步、在等谁、日期。
- **你在面板里改**：勾一下、双击改字、底部输入框新增；点会话标记跳到那个 pane。
- **agent 用 `vibing` 命令行改**，文件锁保证多方同时写不出错。Claude Code 适配层是两个 hook 加三句规则：动手前先写计划；计划外的事先登记再处理；处理完报一句下一条计划是什么。
- **会话是临时的，事不是**：会话结束标记变灰，事可以交给别的 pane。

## 第一版不做

甘特图、Homebrew、其他 agent 的适配。数据模型已经给这些预留了字段。

## 许可证

GPL-2.0-or-later。面板通过 `iterm2` Python 包注册，那个包是 GPLv2+，整个项目跟它一致。
