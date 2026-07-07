# 测试任务 🧪

## 现状

**当前 0 测试。这是最大的技术债。** 没有测试，所有重构都不敢动手。

## 原则

- **先测核心逻辑，再测 UI**——Tree 数据操作 > API 路由 > DOM 渲染
- **不追求覆盖率数字，追求"改了敢重构"**——能让你放心拆 server.ts 的测试才是好测试
- **用 Node 原生测试**——`node --test`（Node 22 内置），不加测试框架依赖

## 任务

| 优先级 | 任务 | 说明 | 工作量 |
| --- | --- | --- | --- |
| P1 | **后端路由集成测试** | server.ts 拆路由后，为每个路由处理器写 HTTP 请求测试（使用 `node:http` 或 `supertest`） | 2 天 |
| P1 | **Tree 组件单元测试** | `ui/tree.ts` 的数据操作（setData/setChildren/展开/选中）纯逻辑可测，与 DOM 解耦测试 | 1 天 |
| P1 | **ExplorerService 测试** | `service/explorer-service.ts` 的 API 调用逻辑，mock fetch | 1 天 |
| P2 | **Agent 集成测试** | 自定义 Tool 注册后，测试 Tool 调用链路是否正确 | 2 天 |
| P2 | **前端渲染测试** | pane 渲染函数（explorerRender、msgs、sinfoHTML）的 DOM 输出快照测试 | 1 天 |
| P3 | **E2E 测试** | Electron + pi-server 全链路：启动 → 打开文件 → 编辑 → 保存 → AI 对话 | 3 天 |
