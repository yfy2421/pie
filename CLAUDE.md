# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

一个 TypeScript 项目，基于 PI 框架 (`@earendil-works/pi-coding-agent`) 的自定义 code agent。

**设计原则：桌面端为主，CLI 为辅，统一配置。** 不再是两个平行项目。

**学习路线**：见 [tasks/](tasks/README.md)（已完成 → 架构 → 框架 → 功能 → 测试 → 冲刺）

## 入口

| 命令 | 用途 |
| :--- | :--- |
| `npm start` / `npm run dev` | 启动桌面（Electron + 热重载） |
| `npm run cli` | 终端 CLI 模式 |
| `npm run build` | 构建 Vite 前端 + Electron 主进程 |
| `npm run dist:portable` | 构建 + 打包为 Windows 便携 exe |
| `npm run build:vite` | 仅构建 vite 前端 |
| `npm run build:electron` | 仅编译 Electron 主进程 (`tsc -p tsconfig.electron.json`) |
| `npx pi` | 原始 PI CLI（对比用） |

无测试 / lint / CI 配置。

## 目录结构

```text
my-code-agent/
├── src/
│   ├── server/
│   │   ├── main.ts              ← CLI 入口 (tsx src/server/main.ts --cli)
│   │   ├── server.ts            ← HTTP 服务器（精简后通过 routes/ 分发）
│   │   └── routes/              ← 路由按领域拆分（每个文件 150-200 行）
│   │       ├── index.ts         ← 路由注册器：dispatchRoute()
│   │       ├── types.ts         ← 共享上下文（ServerContext, RouteHandler）
│   │       ├── chat.ts          ← POST /api/chat, GET /api/chat/stream (SSE)
│   │       ├── dashboard.ts     ← GET /api/dashboard, /api/paths, /layout-config
│   │       ├── sessions.ts      ← Session CRUD（列表/新建/删除/重命名/消息）
│   │       ├── explorer.ts      ← 文件浏览 + 操作（新建/重命名/删除/移动/写入）
│   │       ├── git.ts            ← Git 状态/日志/提交/推送/拉取
│   │       ├── search.ts         ← 文件名/全文搜索
│   │       ├── typescript.ts     ← tsserver 语言服务代理
│   │       └── settings.ts      ← 设置 / API Keys / 模型切换 / auth
│   ├── agent/                   ← PI 之上叠的自定义层
│   │   ├── index.ts             ← initAgent() 封装 createAgentSession()
│   │   ├── prompts.ts           ← System prompt 分片管理
│   │   └── tools/
│   │       └── index.ts         ← 自定义 Tool 注册（扩展点）
│   ├── electron/
│   │   ├── electron-main.ts     ← Electron 主进程 + pi-server 崩溃自动重启 + 健康检查
│   │   └── preload.ts           ← contextBridge（已修复，完整暴露 electronAPI）
│   ├── frontend/
│   │   ├── dashboard.html       ← 主界面（单 HTML，CSS Grid 三栏布局）
│   │   ├── dashboard.css        ← 全部样式（CSS 变量 + 黑暗主题）
│   │   ├── dashboard.d.ts       ← 共享类型 + App 命名空间声明
│   │   ├── dashboard-helpers.ts ← 全局状态、App 命名空间基础、Pane 注册
│   │   ├── dashboard-layout.ts  ← DOM 构建、侧边面板、Tab 系统
│   │   ├── dashboard-chat.ts    ← 消息渲染、SSE 流式追加、模型切换
│   │   ├── dashboard-menus.ts   ← 文件菜单、CLI 启动
│   │   ├── dashboard-settings.ts← 设置模态框、API Key 管理、模型选择
│   │   ├── dashboard-sessions.ts← 会话 CRUD
│   │   ├── service/
│   │   │   └── explorer-service.ts  ← 文件浏览器服务层
│   │   ├── ui/
│   │   │   └── tree.ts          ← 可复用 Tree 组件
│   │   ├── pane/
│   │   │   ├── explorer/index.ts ← 资源管理器面板（registerPane）
│   │   │   ├── chat/index.ts     ← 会话列表面板（registerPane）
│   │   │   ├── search/index.ts   ← 搜索面板（registerPane）
│   │   │   └── git/index.ts      ← Git 面板（registerPane）
│   │   └── editor/
│   │       ├── monaco-setup.ts  ← Monaco 编辑器集成（NLS 中文预加载 + tsserver 语言服务）
│   │       └── monaco-setup.js  ← 编译产物（由 compile-frontend-ts 生成）
│   ├── layout-config.json       ← 布局配置
│   └── _archive/                ← 废弃的 Vite 备选前端
├── data/pi/                     ← 唯一运行时配置
├── .pi/extensions/pi-dashboard/ ← PI 扩展
├── scripts/
│   ├── dev.mjs                  ← 开发启动
│   ├── build-frontend.mjs       ← 构建脚本
│   ├── compile-frontend-ts.mjs  ← 开发时 .ts → .js 编译
│   └── clean.mjs                ← 清理残留进程
├── layout-designer.html         ← 布局原型设计器
├── .mcp.json                    ← MCP 服务器配置
├── tsconfig.json                ← 服务端代码编译
├── tsconfig.electron.json       ← Electron 主进程编译
├── vite.config.ts               ← Vite 前端构建（optimizeDeps.exclude 保证 Monaco NLS 预加载顺序）
└── vite.electron.config.ts      ← Electron 备选构建
```

## 架构

### 开发模式：三个独立进程

```text
[Vite Dev Server :5173]     ← HMR，HTML + CSS 即时更新
       │ 代理 /api → :3099
       │
[pi-server :3099]            ← spawn(npx tsx src/server/server.ts)
       │  HTTP API + SSE
       │  createAgentSession()
       v
[Electron]                   ← 加载 http://127.0.0.1:5173（或 :3099）
       - BrowserWindow（无框窗口 titleBarStyle: "hidden"）
       - preload.ts → window.electronAPI
```

`scripts/dev.mjs` 管理三者生命周期：清理旧进程 → 编译 Electron → 编译前端 .ts → 启动 Vite → 启动 server → 启动 Electron → 文件监听自动重启。

- `server.ts` 变化 → 仅重启 pi-server
- `electron-main.ts` / `preload.ts` 变化 → 重建 + 重启 Electron
- 前端文件变化 → Vite HMR 即时更新，无需重启

### 生产模式

```text
[Electron Main Process]
  ──spawn(npx tsx)→ [server.ts 子进程]
       │                  │
       │  loadURL(:PORT)  │  HTTP API + SSE
       v                  v
  [BrowserWindow]    [PI SDK - ReAct Loop]
```

- Electron 自己启动 pi-server 子进程（30s 超时，解析 `SERVER_PORT:N` 确定端口）
- `data/` 目录在 exe 旁边自动创建
- 构建产物：`dist/frontend/`（Vite 输出） + `dist-electron/`（tsc 编译）
- 生产模式下 Electron 负责全生命周期；dev 模式下由 `dev.mjs` 管理三个进程

### 桌面端现状与差距

**Electron 主进程** (`src/electron/electron-main.ts`)：

- 支持 dev 模式（从 Vite 加载）和生产模式（自启 pi-server）
- IPC 通道：窗口控制、文件对话框、新窗口、终端 CLI 启动、"在文件夹中显示"、移到废纸篓
- 5 秒兜底强制显示窗口（`ready-to-show` 防呆）
- 退出时 `taskkill /F /T` 清理进程树

**Preload 桥** (`src/electron/preload.ts`) — 已修复，完整暴露：

```typescript
electronAPI: {
  minimize, maximize, close,          // 窗口控制
  newWindow(),                         // 新建窗口
  openFile(),  openFolder(),           // 文件对话框
  showItemInFolder(path),             // 资源管理器定位
  trashItem(path),                     // 移到废纸篓
  spawnTerminal(),                     // 启动终端 CLI
}
```

**服务层 + 渲染层分离的 Explorer 实现**（`task.md` 标注完成度 95%）：

- `service/explorer-service.ts` —— API 调用、工作区管理、文件操作（新建/重命名/删除/移动）、1556 个 vscode-icons SVG 图标映射、SSE 自动刷新
- `ui/tree.ts` —— 可复用 Tree 组件：懒加载、缓存、键盘导航（↑↓→←Home/End）、Type-ahead 查找、拖放移动、右键菜单、行内编辑（IME 支持）、展开状态缓存持久化（localStorage）、_fetchGen 异步竞争控制
- `pane/explorer/index.ts` —— 面板渲染、错误处理（403/404/超时）、上下文菜单、树内拖放移动（刷新两边目录）、文件打开触发标签页

**标签页系统**（`FileTab` / `_fileTabs` / `_activeFileTab`）：已实现，点击文件在聊天区上方打开 VS Code 风格标签页，支持多标签切换和关闭。

**Pane 注册系统**（`registerPane` / `getPane`）：已实现，所有面板已迁移：

| 面板 | 文件 | 状态 |
| --- | --- | --- |
| 资源管理器 | `pane/explorer/index.ts` | ✅ 已迁移 |
| 会话历史 | `pane/chat/index.ts` | ✅ 已迁移 |
| 搜索 | `pane/search/index.ts` | ✅ 已迁移 |
| Git | `pane/git/index.ts` | ✅ 已迁移 |

`renderPanel()` 中的内联 fallback 分支已删除，所有面板走统一的 pane 注册系统。

**类型声明与实际一致**（`src/frontend/dashboard.d.ts` vs preload.ts）— 已修复 ✅

| 类型声明了 | 实际暴露 | 状态 |
| --- | --- | --- |
| `newWindow()` | ✅ | 已添加 |
| `openFile()` | ✅ | 已添加 |
| `trashItem()` | ✅ | 已添加 |
| `spawnTerminal()` | ✅ | 已添加 |

**前端命名空间收敛** — 整个迁移中 ✅

全局函数从 `window.xxx` 逐步归到 `App.*` 命名空间：

| 原模式 | 新模式 | 状态 |
| --- | --- | --- |
| `window.layout`, `window.togglePanel` | `App.UI.*` | 已注册绑定 |
| `window.msgs`, `window.bind` | `App.Chat.*` | 已注册绑定 |
| `window.fileAction`, `window.launchCli` | `App.File.*` | 已注册绑定 |
| `window.loadSessions`, `window.newSession` | `App.Session.*` | 已注册绑定 |
| `window.openSettingsModal`, `window.selectModel` | `App.Settings.*` | 已注册绑定 |

`window.xxx` 别名保留用于 `onclick` 向后兼容，后续逐步迁移 HTML 模板中的引用。

**前端预埋但未实现的功能**（`dashboard.d.ts` 中已有类型，但无对应实现）：

- ~~`FileTab` / `_fileTabs` / `_activeFileTab`~~ — 已实现 ✅
- ~~`Tree` class + `TreeNode`~~ — 已实现（`ui/tree.ts`）✅
- ~~`registerPane` / `openFileTab` / `closeFileTab` — Pane 注册系统~~ — 已实现 ✅
- ~~`ExplorerService`~~ — 已实现（`service/explorer-service.ts`）✅

**dev.mjs 已知问题**：注释说 "如需 HMR 取消注释 VITE_DEV_PORT"，但 line 148 实际已设为 `String(VITE_PORT)` —— 注释过时，需更新。

### CLI 模式（辅助入口）

`src/server/main.ts` 通过 `src/agent/index.ts` 的 `initAgent()` 启动 agent session，终端 readline 交互。

### PI SDK 集成

- `createAgentSession()` 由 `src/agent/index.ts` 的 `initAgent()` 封装
- `DefaultResourceLoader` 从 `.pi/` 加载扩展/skills/templates
- `ModelRegistry` 管理多 LLM 提供商（Anthropic/DeepSeek/OpenAI/Google 等）
- `AuthStorage` 管理 `data/pi/auth.json`
- `SessionManager` 管理 `data/pi/sessions/*.jsonl`
- 会话 `subscribe()` 监听 `message_update`（text_delta/thinking_delta）和 `agent_end` 事件
- 热切换模型：`session.setModel(model)` 即时生效

### 前端（纯客户端 SPA）

- **无框架**：vanilla TypeScript 编译为 JS，通过全局 `window.__state` 共享状态
- **7 个核心模块**：helpers → layout → chat → menus → settings → sessions
- **4 个 Pane 模块**：explorer, chat, search, git (通过 `registerPane` 注册)
- **App 命名空间**：全局函数收敛到 `App.UI / App.Chat / App.File / App.Session / App.Settings`
- **构建管线**：开发时 esbuild transform .ts→.js → Vite build HTML+CSS → 生产用 esbuild 合并 6 个 JS + 压缩
- **SSE 流**：`/api/chat/stream` Server-Sent Events 实时推送 AI 回复
- **引用文件**：从目录树拖放 / 编辑器右键菜单 / + 按钮添加文件/文件夹/代码片段作为 LLM 上下文附件，服务端读文件内容拼入 prompt（64KB/文件，256KB 总量）
- **模式选择**：自动 / 解释 / 计划三种模式，发消息时按模式在消息前拼指令（纯指令版，不碰工具集）。思考深度分 5 档（低/中/高/极高/最高），控制回答详细程度
- **CSS Grid 三栏**：侧边菜单 60px | 组件面板 174px（可拖拽关闭） | 主聊天区

### PI 扩展

`.pi/extensions/pi-dashboard/index.ts` 是一个独立的 PI 扩展，提供 `/dashboard` 和 `/dash` 命令，在浏览器中打开独立的仪表盘页面（比 server.ts 的 dashboard.html 更丰富）。它：

- 通过 PI 的 `ExtensionAPI` 注册命令和事件监听
- 启动独立 HTTP 服务器（随机端口）
- 监听 `message_update` / `agent_end` 事件实现自己的聊天 SSE
- 提供工具开关、思考等级切换、会话统计等

## 当前里程碑

### ✅ 已完成（来自 [tasks/architecture.md](tasks/architecture.md)）

| 优先级 | 任务 | 状态 |
| --- | --- | --- |
| P0 | **server.ts 路由拆分** → `src/server/routes/{chat,dashboard,sessions,explorer,settings}.ts` | ✅ |
| P0 | **Agent 层封装** → `src/agent/`（`prompts.ts` + `tools/index.ts` + `index.ts`） | ✅ |
| P1 | **Pane 模块化** → 所有面板走 `registerPane`，删除内联 fallback | ✅ |
| P1 | **Electron 崩溃恢复** → pi-server 自动重启、健康检查、preload 桥修复 | ✅ |
| P2 | **命名空间收敛** → `window.xxx` 归到 `App.UI / Chat / File / Session / Settings` | ✅ |

### 🚧 待完成

- [ ] P2: 构建管线统一 — tsc/tsx + esbuild + Vite 三条线的简化
- [ ] HTML 模板 `onclick` 迁移到 `App.*` 命名空间引用

## 与 Claude Code 的架构差距（TODO）

当前项目已具备仿 VS Code 的桌面编辑器基础（文件树、标签页、Pane 系统），但 Agent 层仍是 PI 默认行为。参考 Claude Code 泄露源码（v2.1.88），以下是需要逐步补齐的能力：

### 1. System Prompt 分片缓存

当前：写在 `server.ts` 里，一段定稿传给 PI。
目标（参考 `src/constants/prompts.ts` + `systemPromptSections.ts`）：

```typescript
// 分片组装，每片独立缓存
systemPromptSection('session_guidance', () => getSessionGuidance(...))
systemPromptSection('memory', () => loadMemoryPrompt())
systemPromptSection('mcp_instructions', () => getMcpInstructions(...))
// 需要时强制刷新
DANGEROUS_uncachedSystemPromptSection('env_info', () => computeEnvInfo(...), 'cwd changes')
```

- `systemPromptSection()` 的结果缓存到 `/clear` 或 `/compact`
- `DANGEROUS_uncachedSystemPromptSection()` 每次可能重算，但标明原因
- 最终合并: `resolveSystemPromptSections(sections)` → 加入 context

### 2. 自定义 Tool 注册

当前：全用 PI 内置的 read/write/edit/bash/grep/find/ls（见 `packages/coding-agent/src/core/tools/`）。
目标：注册自己的 Tool，参考 PI 的 Tool 接口定义（`packages/agent/src/types.ts`），在 `createAgentSession()` 的 tools 参数传入。

面试关键问题：Tool 调用安全性（路径沙箱、命令白名单）、并发写入同一个文件的处理、上下文窗口满了的压缩策略。

### 3. 子 Agent 编排

当前：无。
目标（参考 `src/coordinator/coordinatorMode.ts`）：

```text
[Coordinator] ─→ Agent(spawn) ─→ Worker 1 (research)
               ─→ Agent(spawn) ─→ Worker 2 (research)
               ─→ SendMessage → Worker 1 (implement)
```

关键规则：

- worker prompt 必须**自包含**（看不到 coordinator 的对话历史）
- **Research → Synthesize → Implement → Verify** 四阶段
- read-only 任务全部并行，write 任务按文件隔离
- verify 必须独立的 agent，不能自己给自己打分

### 4. MCP 客户端增强

当前：仅配置了 `.mcp.json`（image_mcp: SiliconFlow）。
目标：复用 `@modelcontextprotocol/sdk`，实现 transport 层（参考 `src/services/mcp/client.ts` + `InProcessTransport.ts`）。

Claude Code 支持的 transport：stdio / SSE / HTTP / WebSocket / SDK / in-process

### 5. 集成路线

Claude Code 的 SDK 层（`@anthropic-ai/sdk`）在本项目中对应 PI 的 `@earendil-works/pi-coding-agent`。
不替换 PI，而是**在 PI 之上叠你自己的层**：自定义 system prompt → 注册自定义 Tool → 覆盖 agent-loop 部分逻辑。

## 关键模式

- **TypeScript + ESM** (`"type": "module"`) — 所有源文件 .ts
- **`tsx`** 直接运行 TypeScript，无需预先构建
- **三个 tsconfig 文件**：
  - `tsconfig.json` — 服务端代码 (`src/server/`)
  - `tsconfig.electron.json` — Electron 主进程 (`src/electron/`, 输出到 `dist-electron/`)
  - `src/frontend/tsconfig.frontend.json` — 前端类型检查（不参与编译，编译用 esbuild）
- **CSS 变量 + 黑暗主题**：`--bg: #0A0A0F` 深色背景，amber (`#F59E0B`) 强调色
- **窗口装饰**：`titleBarStyle: "hidden"` + 自定义顶栏 + CSS 按钮 `-webkit-app-region: drag/no-drag`
- **会话持久化**：JSONL 格式，每条消息一行 JSON，支持分支（tree）和 session_info 元数据
- **配置统一**：`data/pi/auth.json` 是唯一 API Key 存放位置，环境变量仅做 fallback
- **自定义扩展**：`.pi/extensions/` 放置 PI 扩展，参见 PI 框架的 extension API
- **MCP**：`.mcp.json` 配置 MCP 服务器（当前只有 image_mcp）
