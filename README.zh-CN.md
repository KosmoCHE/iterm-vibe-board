# iterm-vibing-board

住在 iTerm2 侧栏里的进度看板，以人为中心，你和每个 pane 里跑着的 AI coding agent 一起维护。

> **状态：pre-alpha。**从 clone 里跑，面板、`vibing` 命令行和 Claude Code 适配层都能用；还没有安装脚本，数据格式也可能再改。

[English](README.md)

## 为什么

同时开好几个 Claude Code 会话时，iTerm2 自带的 Session Status 能告诉你哪个 pane 在跑、在等、闲着。它回答不了的是：

- **我**要做什么，每件事是哪个 pane 在推？
- 哪些是原计划里的，哪些是半路冒出来的？
- 现在有哪些事在等我？

agent 那一侧的任务清单（Claude Code 自带的 `TaskCreate`，以及大多数「agent 看板」工具）都是从 agent 的角度回答：折叠在对话里、你改不了、一个 agent 一份。这个看板反过来：事是你的，agent 只是在推的人。

## 做什么

- **一个面板三页**，在 iTerm2 侧栏（View › Toolbelt › Vibing）：
  - **Global**：所有的事，按项目分组；一个筛选框可以只看一个项目或一个 session。
  - **Project**：聚焦 pane 里的会话所在项目的事（按 Claude Code 启动目录算）。
  - **Session**：聚焦 pane 里的会话正在推的事。

  Project 和 Session 绑定你点进的 pane，和 iTerm2 的 Notes 一样。
- **每件事记**：状态（`todo`、`doing`、`waiting`、`later`、`done`）、推进者（哪个 session 在推，也可以没有）、来源、谁建的、子步骤、依赖（可跨项目）、下一步、在等谁、日期。
- **来源说的是这件事为什么存在**，事情堆起来时原计划仍然看得见：
  - `plan`：动手前写下的；
  - `incident`（⚡）：半路冒出来的问题，不处理原计划走不下去；
  - `insert`（+）：计划定了以后新加的需求，不处理原计划照样能完成。

  父级那一行显示 `●2/4 · +0/1 · ⚡0/1`：每类来源各自的「做完/总数」，只数直接子步骤。
- **你在面板里改**：勾一下、单击看详情、双击改、右上角 `+` 新增、⌘Z 撤销。点会话标记跳到那个 pane；会话结束标记变灰，事可以交给别的 pane。
- **agent 用 `vibing` 命令行改**。`vibing instructions` 打印规则：动手前把计划写成子步骤；计划外的事先登记再处理；绕路结束后说一句下一条计划是什么。会话靠它所在的 pane 识别。
- **Claude Code 适配层**：一个装着这些规则的 skill，加两个 hook（`SessionStart`、`SessionEnd`）把 pane 对应到会话。见 [adapters/claude-code](adapters/claude-code/README.md)。

## 试一下

```sh
git clone https://github.com/KosmoCHE/iterm-vibing-board && cd iterm-vibing-board
./install.sh
```

它把 `vibing` 启动器放进 `~/.iterm-vibing-board/bin/`（并加进 PATH），链接 Claude Code 的 skill 和 hook，把面板注册为 iTerm2 的 AutoLaunch 脚本。然后在 View › Toolbelt › Vibing 打开它。`git pull` 之后重跑一次；`./install.sh --uninstall` 全部撤掉。

数据在 `~/.iterm-vibing-board/`：每件事一个 JSON 文件，放在 `projects/<key>/items/` 下，另有一张 pane 到会话的小表。设 `VIBING_HOME` 可以换目录。

## 要求

- macOS，iTerm2 3.5 以上，开启 Python API（Settings › General › Magic），并装好它的 Python 运行时（Scripts › Manage › Install Python Runtime），面板脚本靠它跑。
- 命令行要 Python 3.9 以上，Xcode 命令行工具自带的那个就够。
- Claude Code（第一个 agent 适配层）。

## 第一版不做

图或甘特视图、Homebrew、其他 agent 的适配。数据模型已经给这些预留了字段。

## 目录

```
vibing/               Python 包：存储、命令行、本地 HTTP 服务（只用标准库）
panel/                侧栏页面：纯 HTML、CSS、JS，无构建
iterm/                注册面板的 iTerm2 AutoLaunch 脚本
adapters/claude-code/ Claude Code 的 skill 和 hook
tests/                pytest，只测核心逻辑
install.sh            把上面这些链接到位
```

## 许可证

GPL-2.0-or-later。面板通过 `iterm2` Python 包注册，那个包是 GPLv2+，整个项目跟它一致。
