# 框架任务 🔧

## 原则

- **PI 是引擎，不是胶水**——不把 PI 当黑盒调，但要读通 `agent-loop.ts` 和 `types.ts`
- **Tool 接口复用 PI 类型**——不要自创 Tool 协议，PI 的 `AgentTool` 接口够用
- **Extension 优先于侵入式修改**——能不碰 PI 源码就不碰，用扩展机制注入
- **一次实现，两个入口**——每个后端 API 同时是人类 UI 和 agent tool 的公共能力层

## 核心架构：API 即 Tool

智能体编辑器的核心模式：**编辑器的每一个能力，都是 agent 可以调用的 tool。**

```text
                    ┌──────────┐
                    │   Agent   │
                    └──┬────┬──┘
                       │    │
          ┌────────────▼┐ ┌─▼──────────────┐
          │  前端（人类）  │ │  Agent Tools   │
          │  click/search │ │  searchFiles() │
          │  click/git   │ │  gitStatus()   │
          │  click/file  │ │  readFile()    │
          └──────────────┘ └─┬──────────────┘
                             │
                    ┌────────▼────────┐
                    │  后端 HTTP API   │
                    │ /api/search     │
                    │ /api/git/status │
                    │ /api/file/read  │
                    └─────────────────┘
```

设计约束：

- 后端 API 不假定调用方是人类还是 agent；返回结构化 JSON，不包含 HTML
- agent 不绕过后端 API 直接用 Bash 做搜索/Git/文件操作
- 新加功能时必须同时考虑：API 设计（供前端调）+ Tool 注册（供 agent 调）

## LSP 可插拔语言服务器架构

当前：tsserver（fork + IPC）→ HTTP 路由 → 前端手写 Provider，仅支持 TS/JS。

目标：

```text
[Monaco Editor]
    │  Language Provider 适配器层（按文件扩展名分发）
    ├─ .ts/.tsx  →  tsserver（已有）
    ├─ .py       →  pyright（要装）
    ├─ .rs       →  rust-analyzer（要装）
    ├─ .go       →  gopls（要装）
    │  ...
    ▼
[pi-server LSP Manager]
    │  管理 N 个 LSP 子进程的生命周期
    │  启动 / 重启 / 卸载 / 健康检查
    │  按扩展名路由 JSON-RPC 到对应的 LSP 服务器
    ▼
[tsserver / pyright / rust-analyzer / ...]
```

设计约束：

- **可卸载**：每个 LSP 服务器是个独立的进程，不启动时零资源占用
- **可更换**：同一语言可配不同的 LSP 服务器（如 pylsp 替代 pyright），配置文件决定
- **零新依赖**：前端不新增 npm 包，只改 provider 的数据格式映射
- **API 即 Tool**：LSP 能力（诊断/补全/格式化）同时暴露为 agent 可调用的 tool

## 任务

| 优先级 | 任务 | 说明 | 工作量 |
| --- | --- | --- | --- |
| P0 | **自定义 System Prompt** | `createAgentSession({ systemPrompt: ... })` 加入"黄鸭的 Code Agent"身份 + 自定义行为 | 10 分钟 |
| P0 | **第一个自定义 Tool** | 注册 `src/agent/tools/` 下的第一个封装：`gitStatus()` 或 `searchFiles()` | 0.5 天 |
| P0 | **API 即 Tool：搜索** | `src/agent/tools/search.ts` 包装 `POST /api/search` | 0.5 天 |
| P0 | **API 即 Tool：Git** | `src/agent/tools/git.ts` 包装 `GET /api/git/status` + `GET /api/git/log` | 0.5 天 |
| P1 | **API 即 Tool：文件操作** | `src/agent/tools/fs.ts` 包装 `GET /api/file/read`、`POST /api/file/write` 等 | 0.5 天 |
| P1 | **API 即 Tool：项目信息** | `src/agent/tools/project.ts` 包装 `GET /api/dashboard`、`GET /api/explorer` | 0.5 天 |
| P1 | **PI Extension 定制** | 利用 `.pi/extensions/` 注册命令和事件监听，替代默认仪表盘扩展 | 1 天 |
| P1 | **Session 持久化增强** | 当前 JSONL 存储已满足，考虑分支管理和压缩策略（参考 PI `SessionManager` API） | 1 天 |
| P2 | **MCP 客户端深度集成** | 复用 `@modelcontextprotocol/sdk`，实现多 transport 支持，不依赖 `.mcp.json` 单例 | 2 天 |
| P2 | **子 Agent 编排** | 基于 PI 的 `agent()` 调用实现协作者模式：Research → Synthesize → Implement → Verify | 3 天 |
| P2 | **工具发现机制** | agent 能通过 `/api/tools` 动态发现当前可用的自定义工具列表 | 0.5 天 |
| P2 | **LSP 可插拔语言服务器** | 后端 LSP 进程管理器 + 前端语言 Provider 适配器，支持按文件扩展名分发到不同 LSP 服务器 | 3 天 |
