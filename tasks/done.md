# 已完成 ✅

## Explorer 文件资源管理器（100%）

**架构：** 服务层 (ExplorerService) + 渲染层 (pane/explorer) 分离

**功能：**

- 懒加载展开/折叠、递归子树、缓存
- 键盘导航（↑↓→← Enter Home/End 打字查找）
- 右键菜单（复制路径、打开位置、新建、重命名、删除）
- 拖放移动（树内拖拽、悬停自动展开）
- 行内编辑（IME/中文支持，e.isComposing）
- 文件筛选（node_modules、隐藏文件、二进制、.gitignore）
- 展开/选择/标签页状态持久化（localStorage）
- fs.watch → SSE 自动刷新

## Monaco 代码编辑器（100%）

- 语法高亮、行号、代码折叠、小地图、多光标
- 文件打开 → 编辑 → Ctrl+S 保存闭环
- 自动保存（可选开关）
- 标签页持久化（重启后恢复）
- 标签拖拽排序、右键菜单、··· 更多操作

## 图标系统（100%）

- vscode-icons 原版 SVG 1556 个（本地 `src/frontend/icons/`）
- ~120 种文件类型映射

## 基础设施（100%）

- Vite HMR 热更新
- Electron 开发/生产双模式
- pi-server 崩溃自动重启 + 启动时序优化 + 健康检查
- 清理脚本 kill 残留进程

## 架构重组（2026-07-06）

### P0: 文件搜索 Pane ✅

**架构：** 后端 `/api/search` + 前端 `pane/search/index.ts`

**后端**（`src/server/routes/search.ts`）：

- 两种搜索模式：`filename`（文件名匹配）和 `text`（全文搜索）
- 递归目录遍历，跳过 `node_modules`、`.git`、二进制文件、>1MB 文件
- 结果上限保护（默认 200），路径遍历安全防护
- 支持 GET 和 POST

**前端**（`pane/search/index.ts`）：

- 文件名/全文类型切换按钮
- 大小写开关 Aa
- 300ms 输入防抖 + Enter 快捷搜索
- 文件类型图标（ExplorerService.iconFor）
- 匹配关键词高亮（`.search-hl` 琥珀色底）
- 点击结果 → 读取文件内容 → 在标签页中打开
- 全文模式显示行号 + 匹配行预览，最多展示 5 处匹配/文件

### P0: Git Pane（只读）✅

**架构：** 后端 `GET /api/git/status` + `GET /api/git/log`，前端 `pane/git/index.ts`

**后端**（`src/server/routes/git.ts`）：

- `git status --porcelain` 解析为结构化变更列表（M/A/D/R/U）
- `git log --oneline -10` 解析为提交历史
- 自动向上查找 `.git` 目录，支持任意子目录

**前端**（`pane/git/index.ts`）：

- 变更区域：统计 chips（修改/新增/删除数量），状态徽章着色（M=黄/A=绿/D=红）
- 提交历史：hash（紫色）+ commit message
- 点击变更文件 → 读取内容 → 在标签页中打开
- 手动刷新按钮

### P0: server.ts 路由拆分 ✅

800+ 行平铺 if-else 拆到 `src/server/routes/` 6 个文件：

- `types.ts` — ServerContext / RouteHandler 共享类型
- `index.ts` — `dispatchRoute()` 组合路由
- `chat.ts` — POST /api/chat, GET /api/chat/stream (SSE)
- `dashboard.ts` — GET /api/dashboard, /api/paths, /layout-config
- `sessions.ts` — Session CRUD 全量（列表/新建/删除/重命名/消息）
- `explorer.ts` — 文件浏览 + 7 种操作（新建/重命名/删除/移动/写入）
- `settings.ts` — API Keys / 模型切换 / auth

`server.ts` 精简为：初始化 → 静态文件 → SSE Events → 路由分发 → 404。

### P0: Agent 层封装 ✅

`src/agent/` 目录，在 PI 框架之上叠自定义层：

- `index.ts` — `initAgent()` 封装 `createAgentSession()`
- `prompts.ts` — `defineSection()` / `resolveSystemPrompt()` 分片管理
- `tools/index.ts` — 自定义 Tool 注册扩展点

server.ts 和 main.ts 均使用 `initAgent()`，消除 PI SDK 内联重复。

### P1: Pane 模块化 ✅

所有 4 个面板走统一的 `registerPane` 注册：

- `pane/explorer/index.ts` — 资源管理器（原有）
- `pane/chat/index.ts` — 会话历史（迁移自内联 fallback）
- `pane/search/index.ts` — 搜索（迁移自内联 fallback）
- `pane/git/index.ts` — Git（迁移自内联 fallback）

`renderPanel()` 中所有内联 fallback 分支已删除。

### P1: Electron 崩溃恢复 ✅

- 每 30s HTTP 健康检查（`GET /api/dashboard`）
- pi-server 异常退出时自动重启（最多 5 次）
- 重启后自动 `reloadWindow()` 恢复窗口
- preload.ts 补全 4 个缺失 IPC 方法：`newWindow`, `openFile`, `trashItem`, `spawnTerminal`

### P2: 命名空间收敛 ✅

全局函数从 `window.xxx` 归到 `App.*` 命名空间：

| 命名空间 | 包含函数 |
| --- | --- |
| `App.UI` | `$`, `S`, `E`, `F`, `layout`, `togglePanel`, `renderPanel`, `sinfoHTML`, `renderTabs`, `switchTab`, `openFileTab`, `closeFileTab`, `saveCurrentFile` |
| `App.Chat` | `msgs`, `bind`, `updateUI`, `showModelPicker`, `appendDelta` |
| `App.File` | `toggleFileMenu`, `closeFM`, `fileAction`, `launchCli` |
| `App.Session` | `loadSessions`, `newSession`, `renameSession`, `deleteSession`, `switchSession` |
| `App.Settings` | `openSettingsModal`, `closeSettingsModal`, `selectProvider`, `saveApiKey`, `selectModel` 等 |

`window.xxx` 别名保留用于 HTML `onclick` 向后兼容。

## Monaco 语言服务 — tsserver 子进程（2026-07-07）✅

**架构：** `fork()` + `--useNodeIpc`，零额外依赖

**后端**（`src/server/ts-server.ts`）：

- 通过 `child_process.fork()` 启动 tsserver，Node IPC 通信
- 无需 Content-Length 头解析，无需 stdin/stdout 协议处理
- 启动时发送 `configure` + `compilerOptionsForInferredProjects`（参考 VSCode）
- `--useInferredProjectPerProjectRoot` 避免 tsconfig.json 的 rootDir 限制

**后端 API**（`src/server/routes/typescript.ts`）：

| 端点 | 功能 |
| --- | --- |
| `POST /api/ts/open` | 在 tsserver 中打开文件 |
| `POST /api/ts/change` | 同步文件内容变更 |
| `POST /api/ts/close` | 关闭文件 |
| `POST /api/ts/completions` | 自动补全 |
| `POST /api/ts/quickinfo` | 悬停提示 |
| `POST /api/ts/definition` | 跳转定义 |
| `POST /api/ts/references` | 查找引用 |
| `GET /api/ts/diagnostics` | 同步诊断（3 秒轮询） |

所有错误以 `200 + {success: false}` 返回，不用 HTTP 500。

**前端**（`src/frontend/editor/monaco-setup.ts`）：

- 禁用内置 TS Worker 诊断（`noSemanticValidation: true`），仅用 tsserver 避免标记冲突
- 注册 `CompletionItemProvider`、`HoverProvider`、`DefinitionProvider`、`ReferenceProvider`
- 3 秒轮询诊断，通过 `setModelMarkers` 设置
- `editor.hasTextFocus()` 区分用户输入和程序化 setValue，避免恢复标签页时误触

**效果：**

- tsserver 能读 `node_modules`，无 "cannot find module" 假阳性
- IPC 模式零协议解析，启动迅速（~500ms）
- 控制台 `[tsserver] ← msg: response ...` 日志可实时观察 tsserver 状态

## 对话输入框重构 — Slash 命令 + Token 用量（2026-07-07）✅

**布局：** 统一输入容器（`fi-area`），左侧 Token 面板 + 右侧对话框，分隔线分割文本区和按钮栏

**Slash 命令（`src/frontend/dashboard-chat.ts`）：**

- 输入 `/` 弹出快捷命令浮层（`fi-slash`）
- 输入 `/exp` 自动过滤高亮匹配项
- 点击命令或 Tab 键自动填入输入框
- Esc 关闭浮层

**Token 用量：**

- 后端 `GET /api/token-usage` 调用 PI SDK `session.getContextUsage()` → 返回 `{tokens, contextWindow, percent}`
- 前端每 6 秒轮询，左侧面板显示数字 + 进度条

**按钮栏（`fi-actions-bar`）：**

- 模型按钮 → 点击弹出已有的模型选择器
- 模式/引用按钮 → 占位（toast "功能开发中"）
- 发送按钮 → SVG 纸飞机图标，停止状态显示 "停止"

**后端 API**（`src/server/routes/dashboard.ts`）：

- `GET /api/token-usage` — 实时 token 用量

**约定：** 图标尽量用文字替代，必须用时用 SVG `<use>` 而非 emoji

## 标签页/会话持久化（2026-07-07）✅

**localStorage 持久化键：**

| Key | 用途 | 保存时机 |
| --- | --- | --- |
| `file-tabs` | 已打开的文件标签列表 | 打开/关闭标签时 |
| `last-active-tab` | 最后活动的是对话还是哪个代码文件 | `switchTab()` 切换时 |
| `last-session-id` | 最后浏览的会话 ID | `switchSession()` 切换时 |

**恢复流程：**

1. 页面加载 → `restoreFileTabs()` 读取 `file-tabs`，逐个 fetch 文件内容恢复标签
2. 恢复完成 → `restoreActiveTabWith()` 按 `last-active-tab` 切到对话或指定文件
3. 如果是对话 tab → `restoreLastSession()` 加载 `last-session-id` 的会话消息

**已知问题修复：**

- `openFileTab()` 内部调用 `switchTab()` 会覆盖 `last-active-tab` → 修复：在恢复前就先保存目标值，恢复完直接用保存值切 tab

## Electron 启动修复 — ELECTRON_RUN_AS_NODE（2026-07-07）✅

**根因：** 系统环境变量 `ELECTRON_RUN_AS_NODE=1` 强制 Electron 以 Node.js 模式运行，
跳过所有 JS 引导层（`process.type` 永远为 `undefined`，`require('electron')` 内置模块拦截不触发）。

**修复：**

- 从系统注册表（Machine 级别）移除 `ELECTRON_RUN_AS_NODE`
- `scripts/dev.mjs` 启动 Electron 时 `delete env.ELECTRON_RUN_AS_NODE` 做双重防护

**影响范围：** 之前因为 Electron 无法启动，误判为"系统级 Electron 兼容问题"，实际上只是这个环境变量导致的。

## 设置页完善 + 主题系统（2026-07-07）✅

**通用设置页**（`src/frontend/dashboard-settings.ts`）：

| 分区 | 设置项 | 控件 | 即时生效 |
| --- | --- | --- | --- |
| 应用设置 | 启动恢复上次会话 | Toggle | ✅ |
| 应用设置 | 自动保存 | Toggle | ✅ |
| 编辑器 | 字体大小 (10-24) | − / + 按钮 | ✅ `editor.updateOptions` |
| 编辑器 | 缩进（空格/制表符 + 2/4/8） | 双下拉 | ✅ |
| 编辑器 | 主题（应用暗色/应用亮色） | 下拉 | ✅ 同时切换 CSS + Monaco |

**主题系统（`src/frontend/dashboard.css`）：**

- 新增 `.theme-light` class，覆盖全部 CSS 变量（`--bg`/`--tx`/`--bd`/`--bc` 等）
- 新增 `--sd` 阴影变量：暗色 `rgba(0,0,0,.5)`，亮色 `rgba(0,0,0,.1)`
- 所有 `box-shadow` 从硬编码改为 `var(--sd)`
- 消息区渐变 `.mc::after` 从硬编码 `rgba(10,10,15,..)` 改为 `var(--bg)`

**自定义 Monaco 主题**（`src/frontend/editor/monaco-setup.ts`）：

| 主题名 | 背景色 | 适用 |
| --- | --- | --- |
| `app-dark` | `#0A0A0F` | 与应用 `--bg` 融合 |
| `app-light` | `#FAFAFA` | 简约亮色 |

**主题闪屏修复：** `dashboard.html` `<head>` 顶部加内联脚本，在 CSS 加载前读取 localStorage 并设置 `theme-light` 类。

## 会话隔离 + 工作区绑定（2026-07-07）✅

**问题：** 所有会话存储在 `data/pi/sessions/` 根目录，切换项目后旧项目会话仍然显示。

**方案：** 按项目目录名分目录存储。

```text
data/pi/sessions/by-project/
  my-code-agent/    ← 当前项目的会话
  pay/              ← "pay" 项目的会话
  _legacy/          ← 早期创建的旧会话（无 workspace 标签）
```

**关键实现：**

- `sessions.ts`: `wsKey()` 取路径最后一段做 key，`wsDir()` 定位项目目录，`findAllJsonl()` 递归查找
- `chat.ts`: `chatStream.currentWorkspace = workspace` — 记录当前工作区
- `server.ts`: `agent_end` 事件中调用 `tagSessionWorkspace()` — 等 PI 落盘 session 文件后标记 workspace 并移动到对应项目目录
- 旧会话迁移：下次启动时自动从平铺目录移入 `by-project/_legacy/`
- 前端"其他项目"折叠区：显示非当前项目的会话，默认折叠

## SSE 流时序修复 + 删除会话卡死修复（2026-07-07）✅

**问题链：**

```text
window.confirm() → 原生模态阻塞合成器 → 界面卡死
旧 SSE onerror → updateUI() → 禁用输入框 → 删除后对话框无响应
Alt+Tab 强制刷新合成器 → 恢复
```

**修复：**

1. 自定义非阻塞确认弹窗 `confirmAsync()`，替代 `window.confirm()`，避免 Electron 原生模态阻塞
2. 流世代号 `_streamGen`：每个 SSE 连接带递增 ID，旧回调检查 `_streamGen !== gen` 直接 return
3. 先 SSE 再 POST：前端先建立 `EventSource()` 再 `fetch('/api/chat')`，不丢失早期事件
4. SSE 清理顺序：先清 `onmessage/onerror` 再 `close()`
5. 删除后释放 Monaco 焦点 + 暂停 diagnostics 轮询

## 待完成（对话框按钮栏）

| 按钮 | 功能 | 参考 |
| --- | --- | --- |
| `+`（添加引用文件） | 选择文件/文件夹作为 LLM 上下文附件 | Claude Code `@` 引用 |
| `模式`（未实现） | 解释/计划/自动，Effort 滑动条 | Claude Code 的 `/mode` 命令 |

## 长期不计划

| 功能 | 原因 |
| --- | --- |
| 多根工作区 | 当前场景不需要 |
| 撤销/重做文件操作 | 工程量大，收益低 |
| 可扩展贡献系统 | 非框架项目不需要 |
| 在资源管理器中查找 | 键盘 Type-ahead 已够用 |
| 文件结构小地图 | 工程量大 |
