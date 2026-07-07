# 代码重构任务 🔄

## 原则

- **重构有业务价值才做**——不要为了"整洁"重构，要为"加新功能更方便"重构
- **先拆分再优化**——server.ts 拆路由 > 改命名 > 改错误处理
- **每次提交只做一件事**——拆分路由时不改逻辑，改命名时不改功能

## 任务

| 优先级 | 任务 | 说明 | 工作量 |
| --- | --- | --- | --- |
| P0 | **server.ts 路由解耦** | if-else 链 → 按领域路由文件（与架构 P0 重叠） | 0.5 天 |
| P1 | **dashboard-layout.ts 拆分** | 文件当前 430+ 行，包含 tabs、panel、status、拖拽、右键菜单。建议拆为 `layout-tabs.ts` + `layout-panel.ts` + `layout-status.ts` | 1 天 |
| P1 | **全局函数命名清理** | 检查所有 `window.xxx = xxx`，去重未使用的导出，统一命名风格 | 0.5 天 |
| P2 | **错误处理统一化** | 当前大量 `catch { /* ignore */ }`（约 30+ 处）。统一为 `logError` + 用户 toast | 1 天 |
| P2 | **TypeScript 严格模式** | `tsconfig.json` 启用 `noImplicitAny`、`strictNullChecks`，修复现存的类型错误 | 1 天 |
| P3 | **状态类型收敛** | `dashboard.d.ts` 中的类型定义与实际使用对齐（移除未使用的声明，合并重复类型） | 0.5 天 |
