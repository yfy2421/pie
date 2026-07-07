# 安全任务 🔒

| 优先级 | 任务 | 说明 | 工作量 |
| --- | --- | --- | --- |
| P1 | **路径遍历防护** | `/api/file/read|write|explorer` 确保 `root + path` 不会跳出工作区目录 | 0.5 天 |
| P1 | **API Key 存储安全** | 当前 `data/pi/auth.json` 明文存储，考虑加密存储或系统密钥链 | 1 天 |
| P2 | **命令注入防护** | server.ts 中若有 `execSync` 拼接用户输入，确认已转义或白名单 | 0.5 天 |
| P2 | **Content Security Policy** | Electron 渲染进程添加 CSP header，防止 XSS | 0.5 天 |
