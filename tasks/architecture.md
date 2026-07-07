# 架构任务 🏗️

## 原则

- **不要重写，要渐进**——当前 vanilla TS 架构没有框架债，不要为了"整洁"引入 React/Vue
- **Server 路由按领域拆分**——每个文件 150-200 行，一眼看完
- **Agent 层只封装，不 fork**——PI 的 agent-loop 不改，只在其上叠自定义层
- **Electron 是运行时不是框架**——保持 preload 最小暴露原则

## 任务

| 优先级 | 任务 | 说明 | 工作量 | 状态 |
| --- | --- | --- | --- | --- |
| P0 | **server.ts 路由拆分** | 将 800+ 行平铺 if-else 拆到 `src/server/routes/{chat,dashboard,sessions,explorer,settings}.ts` | 0.5 天 | ✅ 已完成 |
| P0 | **Agent 层封装** | `src/agent/` 目录：`prompts.ts` + `tools/index.ts` + `index.ts` 封装 `createAgentSession()` | 0.5 天 | ✅ 已完成 |
| P1 | **Pane 模块化** | 所有面板走 `registerPane`，删除 `renderPanel` 内联 fallback 分支 | 0.5 天 | ✅ 已完成 |
| P1 | **Electron 崩溃恢复** | pi-server 退出时自动重启，主进程添加进程健康检查 | 0.5 天 | ✅ 已完成 |
| P2 | **命名空间收敛** | 全局函数从 `window.xxx` 归到 `App.UI / App.Chat / App.File / App.Session / App.Settings` | 1 天 | ✅ 已完成（window 别名保留用于 onclick 向后兼容） |
| P2 | **构建管线统一** | 目前 `tsc -p tsconfig.electron.json` + `esbuild transform` + `Vite build` 三条线，考虑合并 | 2 天 | ⏳ 待完成 |

## 变更记录

### 2026-07-06

- `server.ts` 路由拆分：新增 `src/server/routes/` 目录，6 个文件
  - `types.ts` — ServerContext / RouteHandler 类型
  - `index.ts` — `dispatchRoute()` 路由注册器
  - `chat.ts` — POST /api/chat, GET /api/chat/stream
  - `dashboard.ts` — GET /api/dashboard, /api/paths, /layout-config
  - `sessions.ts` — Session CRUD 全量
  - `explorer.ts` — 文件浏览 + 7 种操作
  - `settings.ts` — API Keys / 模型切换 / auth
- `src/agent/` 目录：`index.ts` + `prompts.ts` + `tools/index.ts`
  - `initAgent()` 统一入口，替换 inline PI SDK 调用
  - `defineSection()` / `resolveSystemPrompt()` 分片管理
  - server.ts 和 main.ts 均使用 `initAgent()`
- Pane 模块化
  - 新建 `pane/chat/`, `pane/search/`, `pane/git/` 三个面板
  - 全部通过 `registerPane()` 注册，`renderPanel()` 内联 fallback 已删除
- Electron 崩溃恢复
  - 每 30s HTTP 健康检查
  - pi-server 退出时自动重启（最多 5 次）
  - preload.ts 补全 4 个缺失 IPC 方法
- 命名空间收敛
  - `window.App = { UI, Chat, File, Session, Settings }`
  - 各模块末尾添加 App 命名空间绑定
  - `dashboard.d.ts` 添加 `AppNamespace` 接口
