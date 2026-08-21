# cli-delegate

[![linux.do](https://shorturl.at/ggSqS)](https://linux.do)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

跨 harness 的 Agent Skill：在 **Claude Code / Codex / Grok / Cursor** 里，把另外一家的 CLI 拉起来当子进程，并且 **还能 resume 同一条会话**。

它要替代的是「同一家账单上的 subagent」。Claude 的子代理烧的是 Claude 额度；这里 Claude 只当调度，活派给 Grok 或 Cursor，花的是**另一份订阅**。

English: [README.md](./README.md)

## 它解决什么

官方桥（Grok 的 Claude 插件、Cursor-in-Claude 插件）只在 Claude Code 里好用，而且一家对一家。各家 CLI 自己早就有 resume（`grok -r`、`claude -r`、`cursor-agent --resume`、`codex exec resume`），缺的是一层**宿主无关**的封装。

`cli-delegate` 就是那一层：一个脚本 + `SKILL.md`。不是 Teams / 总线（Orca、Herdr 已经做那种事）。

- 任意宿主同一套 `run` / `resume`
- 后台：优先把普通 `run` 丢进宿主自己的 background shell；`--background` / `status` / `log` / `stop` 是逃生口
- `--worktree-name`：同一仓库的并行工作目录，给要续跑的活
- 统一 `--effort`

## 要求

- Node.js >= 18.18
- PATH 上至少有一个：`grok`、`cursor-agent`、`claude`、`codex`

Windows 上 Cursor 一般是 `%LOCALAPPDATA%\cursor-agent\agent.cmd`。用 `cursor-agent`，不要用 `agent`（和 Grok 的 `agent.exe` 撞名）。

不发布 npm。宿主认的是 **skill 目录**，`npx` 不会把它装进 `~/.claude/skills`。

## 安装

装完必须**新开**一轮宿主会话，旧会话可能还拿着旧脚本路径。

### 1. skillshare（推荐）

```bash
skillshare install isCopyman/cli-delegate -s cli-delegate
skillshare sync
```

会拷到 Claude / Codex / Grok / Cursor / `~/.agents`（按你的 skillshare 目标配置）。

以后更新：

```bash
git -C <clone> pull
pwsh -File .\sync-skill.ps1   # 仓库里的脚本，避免 PowerShell 套出 scripts/scripts
skillshare sync -g --force
```

不要对已存在的 `dest\scripts` 再 `Copy-Item -Recurse scripts dest\scripts`，会套娃，Skill 仍调用旧的 `scripts/cli-delegate.mjs`。

### 2. git clone + 联接 / 拷贝

```powershell
git clone https://github.com/isCopyman/cli-delegate.git
cd cli-delegate
pwsh -File .\install.ps1
```

`install.ps1` 需要 PowerShell 7，把 `skills/cli-delegate` **junction** 到已经存在的：

- `~/.claude/skills/cli-delegate`
- `~/.codex/skills/cli-delegate`
- `~/.grok/skills/cli-delegate`
- `~/.agents/skills/cli-delegate`

macOS / Linux 没有 junction 时自己拷或做符号链接：

```bash
git clone https://github.com/isCopyman/cli-delegate.git
SRC="$PWD/cli-delegate/skills/cli-delegate"
for h in "$HOME/.claude/skills" "$HOME/.codex/skills" "$HOME/.grok/skills" "$HOME/.agents/skills"; do
  [ -d "$(dirname "$h")" ] || continue
  mkdir -p "$h"
  rm -rf "$h/cli-delegate"
  ln -s "$SRC" "$h/cli-delegate"
done
```

入口永远是 Skill 旁边的 `scripts/cli-delegate.mjs`，不是 `scripts/scripts/`。

### 3. 验收

在仓库里（或 skill 目录里）跑：

```powershell
node .\skills\cli-delegate\scripts\cli-delegate.mjs which --cli grok
node .\skills\cli-delegate\scripts\cli-delegate.mjs which --cli claude
```

`ready: true` 表示对应 CLI 在 PATH 上。然后新开 Claude / Codex / Grok 会话，直接说「用 cli-delegate 把这活派给 grok」。宿主应去读 `SKILL.md` 并用**绝对路径**调用那个 `cli-delegate.mjs`。

## 使用

人在终端里可以自己跑；Agent 则按 `SKILL.md` 调同一套命令。标准输出是 JSON。

把仓库路径或 skill 路径换成你机器上的绝对路径。Windows Git Bash 用正斜杠：`C:/Users/.../cli-delegate.mjs`。

### 探测

```powershell
node .\skills\cli-delegate\scripts\cli-delegate.mjs which --cli grok
node .\skills\cli-delegate\scripts\cli-delegate.mjs models --cli grok
```

默认不要传 `--model`，跟子 CLI 自己的默认走。`models --cli` 只转发厂商已有的列表命令（`grok models`、`cursor-agent models`、`codex debug models` 抽 slug）。Claude 没有列表命令，不要编一份目录。用户要指定模型时自己传 `--model` 或 `--` 后面的厂商参数。

### 新开一条（用完可停）

任务书放文件，不要 `$(cat …)`：

```powershell
node .\skills\cli-delegate\scripts\cli-delegate.mjs run --cli grok --cwd $PWD --read-only --prompt-file .\brief.md
```

返回里记下 `sessionId`、`jobId`。同一 `--cwd` 上开过多个 grok 时，下次必须 `--resume <sessionId>`，不要让它猜。

### 后台长任务

宿主已经有 background shell（Grok `background: true`、Claude bash bg 等）时，把普通 `run` 丢进去，不要加我们的 `--background`。宿主提醒你的时候就是子 CLI 跑完了。

`--background` 是我们自己的：进程脱离宿主，立刻返回 `jobId`，再用 `status` / `log` / `stop`。宿主不会在子进程结束时提醒你，关会话也不会收掉它。默认 `--timeout` 10 分钟。

```powershell
node .\skills\cli-delegate\scripts\cli-delegate.mjs run --cli grok --cwd $PWD --background --worktree-name ui --prompt-file .\brief.md
node .\skills\cli-delegate\scripts\cli-delegate.mjs status --cli grok --cwd $PWD
node .\skills\cli-delegate\scripts\cli-delegate.mjs log <jobId>
node .\skills\cli-delegate\scripts\cli-delegate.mjs stop <jobId>
```

`--worktree-name ui` 是持久并行环境（同一仓库另一份文件）。还要续跑就不要删这个目录。干净且没有独有 commit 时，新的 `run` 会快进对齐当前 checkout；`resume` 不会快进。

一次性隔离、不打算 resume：用 `--worktree`（每次新文件夹）。只读看当前树：`--read-only`，不要 `--worktree`。

### 续跑

```powershell
node .\skills\cli-delegate\scripts\cli-delegate.mjs resume --cli grok --cwd $PWD --resume <sessionId> --worktree-name ui --prompt-file .\followup.md
```

只有一条记录时，裸 `resume` 会用那条。两条及以上会报错并列出 `candidates`。明确要最新一条才 `--resume-last`。

### 结构化返回（可选）

`--schema schema.json`：Grok/Claude 走 `--json-schema`，Codex 走 `--output-schema`。Cursor 没有，把形状写进任务书。

### 常用 flag

| Flag | 含义 |
|---|---|
| `--prompt-file` | 任务书文件。`--file` 只给 `extract` |
| `--schema` | JSON Schema 文件 |
| `--worktree` | 一次性额外 checkout |
| `--worktree-name` | 具名车道（隐含 `--worktree`） |
| `--background` | 脱离宿主的 worker；宿主不会提醒 |
| `--read-only` | 只读 |
| `--resume <id>` | 续指定会话 |
| `--resume-last` | 续最新一条 |
| `--effort` | `low\|medium\|high\|xhigh\|max`，按 CLI 映射 |
| `-- …` | 后面整段转给子 CLI |

状态目录：Windows `%LOCALAPPDATA%\cli-delegate`，其它 `~/.local/share/cli-delegate`（`CLI_DELEGATE_HOME` 可改）。

合并且确定这条 session 不再 resume 之后，主 agent 用 git 收 worktree：`git worktree remove <worktreePath>`，再 `git worktree prune`。不要在还要续跑时删目录。

## 测试

```powershell
npm test
```

无运行时依赖，不打真模型。

## 许可

MIT，见 [LICENSE](./LICENSE)。

## 致谢

感谢 [LINUX DO](https://linux.do) 社区。
