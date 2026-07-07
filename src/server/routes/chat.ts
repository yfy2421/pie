/**
 * Chat routes — POST /api/chat, GET /api/chat/stream (SSE)
 */
import type { RouteHandler } from "./types";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "fs";
import { resolve, basename } from "path";

export const handleChat: RouteHandler = (req, res, ctx) => {
  const { url, method } = req;
  const cors = { "Access-Control-Allow-Origin": "*" };
  const { session, chatStream, paths: p } = ctx;

  // Switch workspace (update cwd + system prompt)
  if (url === "/api/workspace/switch" && method === "POST") {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", async () => {
      try {
        const { workspace } = JSON.parse(body);
        if (workspace && (session as any)._cwd !== workspace) {
          const s = session as any;
          console.log(`📂 Switching workspace: "${s._cwd}" → "${workspace}"`);

          // 1. 中止当前 agent 操作
          try { await s.abort(); } catch (e: any) { console.log(`  abort: ${e.message}`); }

          // 2. 清除 agent 内部消息，避免旧上下文污染
          try {
            const agentState = s.agent?.state;
            if (agentState?.messages) {
              const count = agentState.messages.length;
              agentState.messages = [];
              console.log(`  cleared ${count} agent messages`);
            }
          } catch (e: any) { console.log(`  clear messages: ${e.message}`); }

          // 3. 更新 CWD
          s._cwd = workspace;
          console.log(`  cwd → ${workspace}`);

          // 4. 更新 resource loader
          try {
            if (s._resourceLoader) {
              s._resourceLoader.cwd = workspace;
              await s._resourceLoader.reload();
              console.log(`  resourceLoader reloaded`);
            }
          } catch (e: any) { console.log(`  resourceLoader: ${e.message}`); }

          // 5. 重建 system prompt（reload 会重新加载 resource loader + 重建 prompt）
          try {
            await s.reload();
            console.log(`  session reloaded`);
          } catch (e: any) { console.log(`  session.reload: ${e.message}`); }

          console.log(`✅ Workspace switched`);
        }
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ ok: true }));
      } catch (err: any) {
        console.log(`❌ Workspace switch error: ${err.message}`);
        res.writeHead(400, { ...cors });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // Send chat message
  if (url === "/api/chat" && method === "POST") {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body);
        const { message, workspace } = parsed;
        chatStream.buffer = "";
        if (workspace) chatStream.currentWorkspace = workspace;
        // 切换 agent 工作目录到当前项目
        if (workspace && (session as any)._cwd !== workspace) {
          const s = session as any;
          console.log(`📂 Chat with workspace: ${workspace} (was: ${s._cwd})`);
          try { s.abort(); } catch {}
          try {
            const agentState = s.agent?.state;
            if (agentState?.messages) agentState.messages = [];
          } catch {}
          s._cwd = workspace;
          try {
            if (s._resourceLoader) {
              s._resourceLoader.cwd = workspace;
              await s._resourceLoader.reload();
            }
          } catch {}
          try { await s.reload(); } catch {}
          console.log(`✅ Chat workspace synced`);
        }
        // 立即返回，不 await prompt()，SSE 流式推送 + agent_end 处理 workspace 标记
        session.prompt(message).catch(() => {});
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ ok: true }));
      } catch (err: any) {
        res.writeHead(400, { ...cors });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // SSE chat stream
  if (url === "/api/chat/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...cors,
    });
    chatStream.response = res;
    req.on("close", () => {
      chatStream.response = null;
    });
    return true;
  }

  return false;
};
