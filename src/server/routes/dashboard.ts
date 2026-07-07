/**
 * Dashboard route — /api/dashboard, /api/paths, /layout-config
 */
import type { RouteHandler, ServerContext } from "./types";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export const handleDashboard: RouteHandler = (req, res, ctx) => {
  const { url } = req;
  const cors = { "Access-Control-Allow-Origin": "*" };
  const { session, paths: p } = ctx;

  // Dashboard data
  if (url === "/api/dashboard") {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({
      modelProvider: session.model?.provider ?? "N/A",
      modelId: session.model?.id ?? "N/A",
      modelContextWindow: session.model?.contextWindow ?? "N/A",
      modelMaxTokens: session.model?.maxTokens ?? "N/A",
      thinkingLevel: session.thinkingLevel ?? "off",
      runtime: process.uptime(),
      messagesCount: session.messages?.length ?? 0,
      isIdle: !session.isStreaming,
      tools: (session.agent?.state?.tools || []).map((t: any) => t.name),
      activeTools: (session.agent?.state?.tools || []).map((t: any) => t.name),
      dataDir: p.DATA_DIR,
      sessionsDir: p.SESSIONS_DIR,
      sessionId: (session as any).sessionManager?.getSessionId?.() ?? "",
      _debug: { sessionsDir: p.SESSIONS_DIR, cwd: process.cwd(), appRoot: p.APP_ROOT },
    }));
    return true;
  }

  // Token usage — context + session stats + cost + provider
  if (url === "/api/token-usage") {
    let cu: any = null;
    let stats: any = null;
    try { cu = (session as any).getContextUsage?.(); } catch {}
    try { stats = (session as any).getSessionStats?.(); } catch {}
    const provider = session.model?.provider ?? "unknown";
    const out: any = { contextUsage: null, sessionStats: null, provider };
    if (cu) out.contextUsage = { tokens: cu.tokens ?? null, contextWindow: cu.contextWindow ?? 200000, percent: cu.percent ?? null };
    if (stats) out.sessionStats = { tokens: stats.tokens ?? null, cost: stats.cost ?? null };
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify(out));
    return true;
  }

  // Path info
  if (url === "/api/paths") {
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(JSON.stringify({
      dataDir: p.DATA_DIR,
      configDir: p.PI_CONFIG_DIR,
      sessionsDir: p.SESSIONS_DIR,
    }));
    return true;
  }

  // Read layout config
  if (url === "/layout-config.json") {
    const layoutPath = resolve(p.APP_ROOT, "src", "layout-config.json");
    let content = "{}";
    try { content = readFileSync(layoutPath, "utf-8"); } catch {}
    res.writeHead(200, { "Content-Type": "application/json", ...cors });
    res.end(content);
    return true;
  }

  return false;
};
