# 性能优化任务 ⚡

## 原则

- **先测量再优化**——不凭感觉优化，用 Chrome DevTools Performance tab 和 `console.time`
- **只解决用户感知的卡顿**——500ms 以下的问题不值得优化
- **大目录支持是硬门槛**——用户可能打开 node_modules 或大型 monorepo，Tree 必须扛住

## 任务

| 优先级 | 任务 | 说明 | 工作量 |
| --- | --- | --- | --- |
| P1 | **Electron 启动速度** | dev 模式目前等待 Vite + pi-server + 编译，优化启动时序 | 1 天 |
| P1 | **大目录渲染性能** | Tree 组件在 5000+ 文件目录下卡顿，考虑虚拟滚动或延迟渲染 | 2 天 |
| P2 | **Monaco 按需加载** | Monaco Editor 体积较大（~5MB），考虑懒加载：首次打开文件时才初始化 | 0.5 天 |
| P2 | **SSE 连接管理** | 当前 `/api/events` 和 `/api/chat/stream` 各自开 EventSource，考虑合并信道 | 0.5 天 |
| P2 | **构建产物体积** | 当前 dev.mjs 编译 Electron 时会 inline 生成 preload.js，考虑只保留 tsc 编译产物 | 0.5 天 |
| P3 | **图标加载优化** | 1556 个 SVG 文件，首次加载 http 请求过多，考虑 sprite 或 base64 内联 | 1 天 |
