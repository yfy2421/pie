/**
 * My Code Agent — Pi 服务器
 * 作为子进程运行，通过 HTTP 提供仪表盘和对话 API
 *
 * 环境变量：
 *   PI_DESKTOP_DATA    - 数据目录
 *   PI_DESKTOP_CONFIG  - pi 配置目录
 *   PI_DESKTOP_SESSIONS - 会话目录
 */
import { initAgent } from "../agent/index";
import { createServer } from "http";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync, statSync, watch } from "fs";
import { dispatchRoute } from "./routes/index";
import type { ServerContext, ChatStreamState } from "./routes/types";
import { TsserverManager } from "./ts-server";

// ─── 路径（绝对路径）───────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..", "..");
const DATA_DIR = process.env.PI_DESKTOP_DATA || resolve(APP_ROOT, "data");
const PI_CONFIG_DIR = process.env.PI_DESKTOP_CONFIG || resolve(APP_ROOT, "data", "pi");
const SESSIONS_DIR = process.env.PI_DESKTOP_SESSIONS || resolve(APP_ROOT, "data", "pi", "sessions");
const SETTINGS_FILE = resolve(PI_CONFIG_DIR, "settings.json");
const FRONTEND_DIR = resolve(APP_ROOT, "dist", "frontend");
const HAS_BUILT_FRONTEND = existsSync(resolve(FRONTEND_DIR, "index.html"));
const FRONTEND_SRC_DIR = resolve(APP_ROOT, "src", "frontend");

// ─── 启动 Pi ──────────────────────────────────────────────────────
async function main() {
  console.log("Starting Pi server...");

  const { session, modelRegistry } = await initAgent({
    agentDir: PI_CONFIG_DIR,
    cwd: APP_ROOT,
    sessionsDir: SESSIONS_DIR,
    authFile: resolve(PI_CONFIG_DIR, "auth.json"),
    modelsFile: resolve(PI_CONFIG_DIR, "models.json"),
  });

  console.log("Pi session ready");

  // ─── 共享可变状态 ────────────────────────────────────────────
  const chatStream: ChatStreamState = { buffer: "", response: null };

  session.subscribe((event: any) => {
    if (!chatStream.response && event.type !== "agent_end") return;

    if (event.type === "message_update") {
      if (!chatStream.response) return;
      const ev = event.assistantMessageEvent;
      if (ev?.type === "text_delta" && ev?.delta) {
        chatStream.buffer += ev.delta;
        try {
          chatStream.response.write(`data: ${JSON.stringify({ type: "delta", text: ev.delta })}\n\n`);
        } catch { /* ignore */ }
      } else if (ev?.type === "thinking_delta" && ev?.delta) {
        chatStream.buffer += ev.delta;
        try {
          chatStream.response.write(`data: ${JSON.stringify({ type: "delta", text: ev.delta, thinking: true })}\n\n`);
        } catch { /* ignore */ }
      }
    }

    if (event.type === "agent_end") {
      try {
        chatStream.response?.write(`data: ${JSON.stringify({ type: "done", text: chatStream.buffer })}\n\n`);
        chatStream.response?.end();
      } catch { /* ignore */ }
      chatStream.response = null;
      chatStream.buffer = "";

      // agent_end 时 session 文件已落盘，此时标记 workspace 并移动
      const ws = chatStream.currentWorkspace || "";
      if (ws) {
        console.log(`  agent_end: tagging workspace "${ws}"`);
        tagSessionWorkspace(session, SESSIONS_DIR, ws).catch(() => {});
      }
      chatStream.currentWorkspace = "";
    }
  });

  /** agent_end 时对 session 文件标记 workspace 并移到对应项目目录 */
  async function tagSessionWorkspace(session: any, sessionsDir: string, workspace: string): Promise<void> {
    try {
      const sid = session.sessionManager?.getSessionId?.();
      if (!sid) { console.log(`  tagSessionWorkspace: no session id`); return; }
      const sMod = await import("./routes/sessions");
      const files = sMod.findAllJsonl(sessionsDir);
      const sFile = files.find((f: string) => f.includes(sid));
      if (!sFile) return;
      const { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } = await import("fs");
      const { resolve, basename } = await import("path");
      const content = readFileSync(sFile, "utf-8");
      const lines = content.trim().split("\n");
      const header = JSON.parse(lines[0]);
      if (header.workspace) return; // 已有标记
      header.workspace = workspace;
      lines[0] = JSON.stringify(header);
      const targetDir = sMod.wsDir(sessionsDir, workspace);
      const targetFile = resolve(targetDir, basename(sFile));
      if (sFile !== targetFile) {
        if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
        writeFileSync(targetFile, lines.join("\n") + "\n");
        unlinkSync(sFile);
      } else {
        writeFileSync(sFile, lines.join("\n") + "\n");
      }
    } catch (e: any) { console.log(`  tagSessionWorkspace error: ${e?.message || e}`); }
  }

  // ─── SSE 客户端集合（用于文件变更推送）──────────────────────────
  const sseClients: any[] = [];

  // ─── tsserver（TypeScript 语言服务，延迟启动）────────────────────
  const tsServer = new TsserverManager();

  // ─── 上下文对象 ──────────────────────────────────────────────────
  const ctx: ServerContext = {
    session,
    modelRegistry,
    chatStream,
    sseClients,
    tsServer,
    paths: {
      APP_ROOT,
      DATA_DIR,
      PI_CONFIG_DIR,
      SESSIONS_DIR,
      SETTINGS_FILE,
      FRONTEND_DIR,
      FRONTEND_SRC_DIR,
      HAS_BUILT_FRONTEND,
    },
  };

  // ─── HTTP 服务器 ─────────────────────────────────────────────
  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    const cors = { "Access-Control-Allow-Origin": "*" };

    // favicon — 返回空内容避免控制台 404 报错
    if (url === "/favicon.ico") {
      res.writeHead(200, { "Content-Type": "image/x-icon" });
      res.end();
      return;
    }

    // 图标文件 — 始终从 src/frontend/icons/ 提供
    const reqPath = url.includes("?") ? url.slice(0, url.indexOf("?")) : url;
    if (reqPath.startsWith("/icons/") && reqPath.endsWith(".svg")) {
      try {
        const iconFile = resolve(FRONTEND_SRC_DIR, reqPath.slice(1));
        const content = readFileSync(iconFile);
        res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=3600" });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return;
    }

    // 静态文件 — 构建产物优先，无则从 src/ 回退
    if (HAS_BUILT_FRONTEND) {
      const filePath = url === "/" ? "/index.html" : url;
      const fullPath = resolve(FRONTEND_DIR, filePath.slice(1));
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        const ext = fullPath.endsWith(".css") ? "css" : "javascript";
        const content = readFileSync(fullPath, fullPath.endsWith(".html") ? "utf-8" : "utf-8");
        res.writeHead(200, { "Content-Type": `text/${ext}; charset=utf-8` });
        res.end(content);
        return;
      }
    } else {
      // 开发模式：从 src/ 直接服务静态文件
      const pathname = url.includes("?") ? url.slice(0, url.indexOf("?")) : url;
      if ((pathname.startsWith("/dashboard") || pathname.startsWith("/ui/") || pathname.startsWith("/pane/") || pathname.startsWith("/service/") || pathname.startsWith("/devicon") || pathname.startsWith("/fonts/") || pathname.startsWith("/devicon-colors") || pathname.startsWith("/icons/") || pathname.startsWith("/core/") || pathname.startsWith("/shell/") || pathname.startsWith("/services/")) && (pathname.endsWith(".css") || pathname.endsWith(".js") || pathname.endsWith(".svg") || pathname.endsWith(".woff") || pathname.endsWith(".woff2"))) {
        const ext = pathname.endsWith(".css") ? "css" : pathname.endsWith(".svg") ? "svg+xml" : pathname.endsWith(".woff") ? "font/woff" : pathname.endsWith(".woff2") ? "font/woff2" : "javascript";
        const isText = ext === "css" || ext === "javascript" || ext === "svg+xml";
        try {
          const filePath = resolve(FRONTEND_SRC_DIR, pathname.slice(1));
          if (isText) {
            const content = readFileSync(filePath, "utf-8");
            res.writeHead(200, { "Content-Type": `text/${ext}; charset=utf-8` });
            res.end(content);
          } else {
            const content = readFileSync(filePath);
            res.writeHead(200, { "Content-Type": ext });
            res.end(content);
          }
        } catch {
          res.writeHead(404);
          res.end("Not found");
        }
        return;
      }
    }

    // 主页
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getDashboardHTML(ctx));
      return;
    }

    // SSE: 文件变更事件
    if (url === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...cors,
      });
      res.write("data: {\"type\":\"connected\"}\n\n");
      sseClients.push(res);
      req.on("close", () => {
        const idx = sseClients.indexOf(res);
        if (idx !== -1) sseClients.splice(idx, 1);
      });
      return;
    }

    // 领域路由分发
    const handled = await dispatchRoute(req, res, ctx);
    if (handled) return;

    // 404
    res.writeHead(404);
    res.end("Not found");
  });

  let watchTimer: any = null;

  const devPort = parseInt(process.env.PI_DEV_PORT || "0", 10);
  server.listen(devPort || 0, "127.0.0.1", () => {
    const addr = server.address();
    if (addr && typeof addr === "object") {
      const port = addr.port;
      console.log(`SERVER_PORT:${port}`);
      console.log(`Pi Desktop server: http://127.0.0.1:${port}`);
    }
    // ─── 文件系统监听 ──────────────────────────────────────────
    try {
      watch(APP_ROOT, { recursive: true }, (eventType: string, filename: string | null) => {
        if (!filename) return;
        const normalized = filename.replace(/\\/g, "/");
        if (normalized.startsWith("data/") || normalized.startsWith("node_modules/") || normalized.startsWith(".git/") || normalized.startsWith(".claude/") || normalized.startsWith("dist/") || normalized.startsWith("example/")) return;
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          const msg = `data: ${JSON.stringify({ type: "refresh", file: filename })}\n\n`;
          for (const client of sseClients) {
            try { client.write(msg); } catch { /* ignore */ }
          }
        }, 500);
      });
      console.log("[watcher] watching " + APP_ROOT);
    } catch (e: any) {
      console.log("[watcher] not available: " + e.message);
    }
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

// ═══════════════════════════════════════════════════════════════════
//  HTML TEMPLATE — 从独立文件读取
// ═══════════════════════════════════════════════════════════════════

function getDashboardHTML(ctx: ServerContext): string {
  if (ctx.paths.HAS_BUILT_FRONTEND) {
    return readFileSync(resolve(ctx.paths.FRONTEND_DIR, "index.html"), "utf-8");
  }
  return readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "frontend", "dashboard.html"),
    "utf-8"
  );
}
