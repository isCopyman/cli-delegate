# cli-delegate

[![linux.do](https://shorturl.at/ggSqS)](https://linux.do)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

跨 harness 的 Agent Skill：在 **Claude Code / Codex / Grok / Cursor** 里，把另外一家的 CLI 拉起来当子进程，并且 **还能 resume 同一条会话**。

它要替代的是「同一家账单上的 subagent」。Claude 的子代理烧的是 Claude 额度；这里 Claude 只当调度，活派给 Grok 或 Cursor，花的是**另一份订阅**。

## 它解决什么

官方桥（Grok 的 Claude 插件、Cursor-in-Claude 插件）只在 Claude Code 里好用，而且一家对一家。各家 CLI 自己早就有 resume（`grok -r`、`claude -r`、`cursor-agent --resume`、`codex exec resume`），缺的是一层**宿主无关**的封装。

`cli-delegate` 就是那一层：一个脚本 + `SKILL.md`。

- 任意宿主同一套 `run` / `resume`
- 后台任务：`--background`、`status` / `log` / `stop`
- `--worktree`：一次性隔离，每次 `run` 一棵新树（从当前 checkout 的 HEAD）
- `--worktree-name`：具名车道，给要 `resume` 的活；落后只警告不拒绝
- 统一 `--effort`，按 CLI 映射

## 要求

- Node.js >= 18.18
- PATH 上至少有一个：`grok`、`cursor-agent`、`claude`、`codex`

Windows 上 Cursor 一般是 `%LOCALAPPDATA%\cursor-agent\agent.cmd`。用 `cursor-agent`，不要用 `agent`（和 Grok 的 `agent.exe` 撞名）。

## 安装

宿主认的是 **skill 目录**，不是 PATH 里的命令。

**skillshare：**

```bash
skillshare install isCopyman/cli-delegate -s cli-delegate
skillshare sync
```

**克隆 + 目录联接**（PowerShell 7）：

```powershell
git clone https://github.com/isCopyman/cli-delegate.git
pwsh -File .\cli-delegate\install.ps1
```

会把 `skills/cli-delegate` 联到已存在的 `~/.claude/skills`、`~/.codex/skills`、`~/.grok/skills`、`~/.agents/skills`。需要**新开**一轮宿主会话才会加载 skill。

## 用法

```powershell
node .\skills\cli-delegate\scripts\cli-delegate.mjs run --cli grok --cwd $PWD --background --worktree --prompt-file .\brief.md
node .\skills\cli-delegate\scripts\cli-delegate.mjs resume --cli grok --cwd $PWD --resume <sessionId> --worktree-name ui --prompt-file .\followup.md
node .\skills\cli-delegate\scripts\cli-delegate.mjs log <jobId>
```

标准输出是 JSON。长任务书用 `--prompt-file`，不要 `$(cat …)`。同一 `--cwd` 上开过多个会话时，`resume` 必须带 `--resume <sessionId>`（或显式 `--resume-last`），不会猜最近一条。

## 许可

MIT，见 [LICENSE](./LICENSE)。

## 致谢

感谢 [LINUX DO](https://linux.do) 社区。
