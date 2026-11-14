# iterm-vibe-board

住在 iTerm2 侧栏和 Paseo 侧栏里的进度看板，以人为中心，你和你跑着的每个 AI coding agent 一起维护。

> **状态：0.1，早期。**面板、`vibeboard` 命令行、Claude Code 适配层和 `install.sh` 都能从 clone 里跑起来；1.0 之前数据格式还可能改。

[English](README.md)

## 断线与恢复

安装器会用当前用户的 macOS LaunchAgent 托管本地数据服务。它仅监听
`127.0.0.1:47431`，不依赖 Codex 会话或 iTerm Python API 连接的寿命；服务异常退出后
由 launchd 自动重启，继续使用原端口和认证 token。iTerm AutoLaunch 脚本负责注册侧栏
和同步当前窗格，任务数据仍保存在 `~/.iterm-vibe-board/`。
服务使用 `~/.iterm-vibe-board/runtime/` 下按内容版本保存的运行文件，避免后台进程
受 `Documents` 目录访问限制影响；`runtime/current` 指向已通过健康检查的版本。
每个版本的 `source.json` 记录来源目录和内容摘要，不包含凭证。
升级启动或健康检查失败时，会恢复旧配置与原运行状态；旧服务通过健康检查后才报告
恢复成功。首次安装失败会清理本次注册和配置；若回滚也失败，会明确报错并提示日志位置。

断线时侧栏顶部显示“当前是旧数据”和最后同步时间，并暂时禁止修改；每秒重试，
单次请求最多等待 5 秒。恢复后重新读取任务，不需要重复执行 `done`。
正在编辑字段时看板照常刷新，已输入的内容保留在输入框里。
这只解决状态同步；任务是否完成仍由你或 agent 根据实际结果更新。

已有安装只升级服务、不改 hooks，可从新版仓库运行：

```sh
python3 -m vibeboard.service
```

若提示端口占用，先在 iTerm2 的 Scripts 控制台停止旧的 `vibeboard_panel.py`，再执行。
安装器不会杀死占用端口的未知进程。随后重新运行新版 AutoLaunch 脚本，以恢复窗格跟随。
LaunchAgent 位于 `~/Library/LaunchAgents/com.github.kosmoche.vibeboard.server.plist`，
故障日志在 `~/.iterm-vibe-board/server.log`。单独卸载服务用
`python3 -m vibeboard.service --uninstall`；完整卸载也会移除它，保留任务数据。

## 为什么

同时开好几个 Claude Code 会话时，iTerm2 自带的 Session Status 能告诉你哪个 pane 在跑、在等、闲着。它回答不了的是：

- **我**要做什么，每件事是哪个 pane 在推？
- 哪些是原计划里的，哪些是半路冒出来的？
- 现在有哪些事在等我？

agent 那一侧的任务清单（Claude Code 自带的 `TaskCreate`，以及大多数「agent 看板」工具）都是从 agent 的角度回答：折叠在对话里、你改不了、一个 agent 一份。这个看板反过来：事是你的，agent 只是在推的人。

## 做什么

- **一个面板三页**，在 iTerm2 侧栏（View › Toolbelt › Vibe Board），以及 Paseo 里每个工作区的侧栏：
  - **Global**：所有的事；一个筛选框可以只看一个项目或一个 session。
  - **Project**：聚焦 pane 里的会话所在项目的事（按 Claude Code 启动目录算），子目录下登记的事也算在内。
  - **Session**：聚焦 pane 里的会话正在推的事。

  Project 和 Session 绑定你点进的 pane，和 iTerm2 的 Notes 一样；在 Paseo 里覆盖面板所在工作区的所有 agent。
- **一个能看出谁等谁的列表**，按 git graph 画提交历史的方式来画。每件事一行，前置在上、等它的在下；每件事一个圆点，每条依赖一条轨道：几件事等同一件就分叉，一件事等几件就汇合，跨 task 也一样。task 的步骤从它下方一条淡色主干上分出来。选中一件事会点亮它上游和下游的全部链路。折叠项的依赖保留为虚线轨道，范围外的前置用一个箭头标记。已完成的默认折叠。每行显示标题、状态、步骤计数和推进它的会话，其余点一下看详情。折叠状态会记住，网页外壳的图标使用随项目提供的 Lucide 子集。
- **每件事记**：状态（`todo`、`doing`、`waiting`、`later`、`done`）、推进者（哪个 session 在推，也可以没有）、来源、谁建的、子步骤、依赖（可跨项目）、下一步、在等谁、日期。
- **来源说的是这件事为什么存在**，事情堆起来时原计划仍然看得见：
  - `plan`：动手前写下的；
  - `issue`（⚡）：半路冒出来的问题，不处理原计划走不下去；
  - `added`（+）：计划定了以后新加的需求，不处理原计划照样能完成。

  task 那一行显示 `2/4`：直接子步骤的「做完/总数」。不在原计划里的事，行尾带 `issue` 或 `added` 标记。
- **做完的任务一周后离开看板**：任务完成超过设定的天数，就连同步骤一起归档，看板保持小而快。右上角齿轮打开的设置里可以改天数，或者设成从不归档。归档里什么都留着，包括完成时间：`vibeboard list --archived` 查看，`vibeboard archive --restore <id>` 取回。
- **字号一处调**：同一个设置里有文字大小，一个百分比管整块面板的文字、图标和行高，iTerm2 和 Paseo 里的面板一起变。
- **你在面板里改**：点圆点勾掉、点一下看详情（加步骤、复制标题、删除都在详情里；右键一行可复制标题或 ID）、连点两下改、右上角 `+` 新增、Undo 撤销（iTerm2 里也可以 ⌘Z）。点会话标记跳到那个 pane 或 agent；会话结束标记变灰，事可以交给别的会话。
- **agent 用 `vibeboard` 命令行改**。`vibeboard instructions` 打印规则：动手前把计划写成子步骤；计划外的事先登记再处理；绕路结束后说一句下一条计划是什么。会话靠它所在的 pane 或 Paseo agent 识别。
- **Claude Code 适配层**：一个装着这些规则的 skill，加两个 hook（`SessionStart`、`SessionEnd`）把 pane 对应到会话。见 [adapters/claude-code](adapters/claude-code/README.md)。

## 试一下

```sh
git clone https://github.com/KosmoCHE/iterm-vibe-board && cd iterm-vibe-board
./install.sh
```

它把 `vibeboard` 启动器放进 `~/.iterm-vibe-board/bin/`（并加进 PATH），链接 Claude Code 的 skill 和 hook，把面板注册为 iTerm2 的 AutoLaunch 脚本。然后在 View › Toolbelt › Vibe Board 打开它。`git pull` 之后重跑一次；`./install.sh --uninstall` 全部撤掉。

### 在 Paseo 里

```sh
paseo plugin install "$PWD/ui"
```

打开 Settings › Plugins › Enable plugins，然后打开工作区的 Explorer 侧栏，在它的 `+` 里加上 Vibe Board。插件读的是同一个本地服务，所以先跑 `./install.sh`。

数据在 `~/.iterm-vibe-board/`：每件事一个 JSON 文件，放在 `projects/<key>/items/` 下，另有一张 pane 到会话的小表。设 `VIBEBOARD_HOME` 可以换目录。

## 要求

- macOS，iTerm2 3.5 以上，开启 Python API（Settings › General › Magic），并装好它的 Python 运行时（Scripts › Manage › Install Python Runtime），面板脚本靠它跑。
- 命令行要 Python 3.9 以上，Xcode 命令行工具自带的那个就够。
- Claude Code（第一个 agent 适配层）。
- Paseo 0.14 以上，只在要把面板放进 Paseo 时需要。

## 第一版不做

甘特视图、Homebrew、其他 agent 的适配。

## 目录

```
vibeboard/               Python 包：存储、命令行、本地 HTTP 服务（只用标准库）
ui/                   面板，用 React Native 只写一份，同时是一个 Paseo 插件：
  client/board/       看板本身，只通过 host.ts 接触它所在的宿主
  web/、dist/         给 iTerm2 网页视图用的外壳和提交进仓库的构建产物
  client/paseo.tsx、server/、shared/、index.*   给 Paseo 用的外壳
iterm/                注册面板的 iTerm2 AutoLaunch 脚本
adapters/claude-code/ Claude Code 的 skill 和 hook
tests/                pytest，只测核心逻辑
install.sh            把上面这些链接到位
```

## 许可证

GPL-2.0-or-later。面板通过 `iterm2` Python 包注册，那个包是 GPLv2+，整个项目跟它一致。
