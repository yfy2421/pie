# My Code Agent — 任务总览

> 项目定位：**智能体编辑器**——编辑器本身是 agent 的工具，agent 是编辑器的驾驶员
>
> 定义：
>
> 1. 接入 LLM，有 agent 内核
> 2. agent 可以自主完成任务
> 3. agent 可以自主使用本编辑器、以及其他软件完成任务
> 4. agent 可以自主使用工作流完成任务
> 5. agent 可以自行复用工作流（不重复造轮子，把已验证的工作流当工具用）
> 6. agent 可以自行改进工作流（根据执行结果迭代优化工作流本身）
> 7. agent 可以自行改进编辑器（dogfooding：agent 用自己改自己）
> 8. 可扩展——允许用户开发和接入扩展（自定义 Tool、新 Pane、MCP 服务器、工作流包）
>
> 核心原则：**一次实现，两个入口**——每个编辑器功能（搜索、Git、文件操作等）都同时暴露给人类 UI 和 agent tool，agent 调用和人类点击走同一套后端 API
>
> 技术栈：Electron + Vanilla TS + Monaco Editor + PI SDK v0.80.3
> 当前完成度：前端 ~95%，Electron ~85%，Server ~95%，Agent ~20%

---

## 目录

- [已完成](done.md) — Explorer / Monaco / 图标 / 基础设施
- ~~[架构任务](architecture.md)~~ ✅ 已完成 — 路由拆分、Agent 封装、Pane 模块化
- [框架任务](framework.md) — System Prompt、自定义 Tool、子 Agent
- [功能开发](features.md) — 搜索、Git、Monaco 语言特性、Token 组件
- [代码重构](refactoring.md) — server.ts 解耦、命名收敛、错误处理
- [测试任务](testing.md) — Tree 测试、路由测试、E2E
- [性能优化](performance.md) — 启动速度、大目录渲染、Monaco 加载
- [体验改进](ux.md) — preload 桥、快捷键、面板宽度记忆
- [文档任务](docs.md) — README、ADR、CLAUDE.md
- [安全任务](security.md) — 路径遍历、API Key 存储、CSP
- [构建/发布](build.md) — Windows/macOS/Linux 打包
- [冲刺计划](sprint.md) — 10 天冲刺

## 各层健康度

| 层级 | 完成度 | 债务 | 下一步 |
| --- | --- | --- | --- |
| Electron 层 | 85% | 仍有一个 `session.once` TS 类型误报 | 生产环境测试 + macOS/Linux 适配 |
| 渲染层（前端） | 95% | HTML onclick 仍用 `window.xxx` 别名 | 迁移到 `App.*` 引用 + 删除别名 |
| Server 层 | 95% | 路由拆分完成，error handling 需统一 | 加请求日志 + 全局错误中间件 |
| Agent 层 | 20% | `src/agent/` 骨架已创建，未注入自定义行为 | 注册后端 API Tool 包装 → 个性化 prompt |
| Tool API 覆盖 | 0% | 后端 API 尚未对 agent 暴露 | 为 `/api/search`、`/api/git/*`、`/api/explorer` 写 Tool 包装 |
| 测试 | 0% | **完全空白** | Tree 单元测试 + 路由集成测试 |
| 安全 | 50% | 路径遍历、Key 存储 | 路径检查 + auth.json 加密 |
| 构建 | 60% | 仅 Windows | 补充 macOS/Linux |
