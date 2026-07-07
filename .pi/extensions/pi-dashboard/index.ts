/**
 * Pi Dashboard — Web GUI
 *
 * A real graphical dashboard for pi coding agent.
 * Opens in your browser with live session stats,
 * model info, tool config, and quick actions.
 *
 * Usage:
 *   /dashboard  - open the web dashboard
 *   /dash       - shorthand alias
 *
 * Install:
 *   Copy to ~/.pi/agent/extensions/pi-dashboard/index.ts (global)
 *   Copy to .pi/extensions/pi-dashboard/index.ts (project-local)
 *
 * Then /reload or restart pi.
 */

import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

// ─── Types ───────────────────────────────────────────────────────────

interface DashboardState {
	sessionStartTime: number;
	totalTurns: number;
	totalToolCalls: number;
}

interface DashboardData {
	state: DashboardState;
	sessionName: string | undefined;
	sessionFile: string | null;
	cwd: string;
	branchLength: number;
	entriesLength: number;
	modelProvider: string;
	modelId: string;
	modelContextWindow: number | string;
	modelMaxTokens: number | string;
	modelCostInput: number;
	modelCostOutput: number;
	thinkingLevel: string;
	contextTokens: number | undefined;
	allTools: ToolInfo[];
	activeToolNames: string[];
}

// ─── Server state ────────────────────────────────────────────────────

let server: http.Server | null = null;
let serverPort = 0;
let currentData: DashboardData | null = null;
let refreshCallbacks: Array<() => void> = [];

// ─── Chat state ──────────────────────────────────────────────────────
interface ChatSSE {
	res: http.ServerResponse;
	aborted: boolean;
}
let chatSSEMap = new Map<string, ChatSSE>();
let pendingMessages: Array<{ id: string; text: string }> = [];
let isProcessingChat = false;
let piSendMessage: ((text: string, opts?: any) => void) | null = null;

function broadcastRefresh(): void {
	for (const cb of refreshCallbacks) {
		try { cb(); } catch { /* ignore */ }
	}
}

// ─── Chat event handlers (set up by extension) ───────────────────────
let chatTextBuffer = "";
let currentChatId: string | null = null;

function onChatMessageUpdate(delta: string): void {
	if (!currentChatId) return;
	chatTextBuffer += delta;
	const sse = chatSSEMap.get(currentChatId);
	if (sse && !sse.aborted) {
		try {
			sse.res.write(`data: ${JSON.stringify({ type: "delta", text: delta })}\n\n`);
		} catch { sse.aborted = true; }
	}
}

function onChatAgentEnd(): void {
	if (!currentChatId) return;
	const sse = chatSSEMap.get(currentChatId);
	if (sse && !sse.aborted) {
		try {
			sse.res.write(`data: ${JSON.stringify({ type: "done", text: chatTextBuffer })}\n\n`);
			sse.res.end();
		} catch { /* ignore */ }
	}
	chatSSEMap.delete(currentChatId);
	currentChatId = null;
	chatTextBuffer = "";
	isProcessingChat = false;
	processNextChatMessage();
}

function processNextChatMessage(): void {
	if (isProcessingChat || pendingMessages.length === 0) return;
	isProcessingChat = true;
	const msg = pendingMessages.shift()!;
	currentChatId = msg.id;
	chatTextBuffer = "";
	if (piSendMessage) {
		piSendMessage(msg.text);
	}
}

// ─── HTML template ───────────────────────────────────────────────────

function serveHTML(res: http.ServerResponse): void {
	res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
	res.end(HTML_TEMPLATE);
}

// ─── API handler ─────────────────────────────────────────────────────

function serveAPI(res: http.ServerResponse): void {
	res.writeHead(200, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*",
	});
	res.end(JSON.stringify(currentData ?? { error: "no data" }));
}

// ─── SSE endpoint for live updates ───────────────────────────────────

function serveSSE(req: http.IncomingMessage, res: http.ServerResponse): void {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		"Connection": "keep-alive",
		"Access-Control-Allow-Origin": "*",
	});

	// Send initial data
	res.write(`data: ${JSON.stringify(currentData)}\n\n`);

	const onRefresh = () => {
		try {
			res.write(`data: ${JSON.stringify(currentData)}\n\n`);
		} catch { /* connection closed */ }
	};

	refreshCallbacks.push(onRefresh);

	req.on("close", () => {
		const idx = refreshCallbacks.indexOf(onRefresh);
		if (idx >= 0) refreshCallbacks.splice(idx, 1);
	});
}

// ─── Start server ────────────────────────────────────────────────────

function startServer(data: DashboardData): Promise<number> {
	return new Promise((resolve, reject) => {
		if (server) {
			currentData = data;
			broadcastRefresh();
			resolve(serverPort);
			return;
		}

		currentData = data;

		server = http.createServer((req, res) => {
			const url = req.url ?? "/";

			if (url === "/" || url === "/index.html") {
				serveHTML(res);
			} else if (url === "/api/dashboard") {
				serveAPI(res);
			} else if (url === "/api/stream") {
				serveSSE(req, res);
			} else if (url.startsWith("/api/toggle-tool/")) {
				const toolName = decodeURIComponent(url.slice("/api/toggle-tool/".length));
				res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
				res.end(JSON.stringify({ ok: true, tool: toolName }));
			} else if (url.startsWith("/api/set-thinking/")) {
				const level = decodeURIComponent(url.slice("/api/set-thinking/".length));
				res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
				res.end(JSON.stringify({ ok: true, level }));
			} else if (url === "/api/chat" && req.method === "POST") {
				let body = "";
				req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
				req.on("end", () => {
					try {
						const { message } = JSON.parse(body);
						const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
						pendingMessages.push({ id, text: message });
						processNextChatMessage();
						res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
						res.end(JSON.stringify({ streamId: id }));
					} catch {
						res.writeHead(400);
						res.end(JSON.stringify({ error: "invalid json" }));
					}
				});
			} else if (url.startsWith("/api/chat/stream/")) {
				const chatId = decodeURIComponent(url.slice("/api/chat/stream/".length));
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					"Connection": "keep-alive",
					"Access-Control-Allow-Origin": "*",
				});
				const sse: ChatSSE = { res, aborted: false };
				chatSSEMap.set(chatId, sse);
				req.on("close", () => { sse.aborted = true; chatSSEMap.delete(chatId); });
			} else {
				res.writeHead(404);
				res.end("Not found");
			}
		});

		server.listen(0, "127.0.0.1", () => {
			const addr = server?.address();
			if (addr && typeof addr === "object") {
				serverPort = addr.port;
				resolve(serverPort);
			} else {
				reject(new Error("Failed to get server port"));
			}
		});

		server.on("error", (err) => {
			server = null;
			reject(err);
		});
	});
}

function stopServer(): void {
	if (server) {
		server.close();
		server = null;
		serverPort = 0;
		refreshCallbacks = [];
	}
}

function openBrowser(url: string): void {
	const platform = process.platform;
	if (platform === "win32") {
		spawn("cmd", ["/c", "start", url], { detached: true, stdio: "ignore" });
	} else if (platform === "darwin") {
		spawn("open", [url], { detached: true, stdio: "ignore" });
	} else {
		spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
	}
}

// ─── Format helpers ─────────────────────────────────────────────────

function formatRuntime(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
	return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function formatCost(tokens: number | undefined, costPer1kInput: number): string {
	if (tokens == null) return "N/A";
	return `$${((tokens / 1_000_000) * costPer1kInput * 1000).toFixed(6)}`;
}

// ─── Extension Entry Point ────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const state: DashboardState = {
		sessionStartTime: Date.now(),
		totalTurns: 0,
		totalToolCalls: 0,
	};

	// ── Wire up chat send function ──
	piSendMessage = (text: string) => {
		pi.sendUserMessage(text);
	};

	// ── Chat event listeners ──
	pi.on("message_update", (_event: any, _ctx: any) => {
		const ev = _event.assistantMessageEvent;
		if (ev?.type === "text_delta" && ev?.delta) {
			onChatMessageUpdate(ev.delta);
		} else if (ev?.type === "thinking_delta" && ev?.delta) {
			onChatMessageUpdate(ev.delta);
		}
	});

	pi.on("agent_end", (_event: any) => {
		onChatAgentEnd();
	});

	function getDashboardData(ctx: any): DashboardData {
		const model = ctx.model;
		const thinking = pi.getThinkingLevel();
		const sessionFile = ctx.sessionManager.getSessionFile();
		const entries = ctx.sessionManager.getEntries();
		const branch = ctx.sessionManager.getBranch();

		return {
			state: { ...state },
			sessionName: pi.getSessionName(),
			sessionFile,
			cwd: ctx.cwd,
			branchLength: branch.length,
			entriesLength: entries.length,
			modelProvider: model?.provider ?? "N/A",
			modelId: model?.id ?? "N/A",
			modelContextWindow: model?.contextWindow ?? "N/A",
			modelMaxTokens: model?.maxTokens ?? "N/A",
			modelCostInput: model?.cost?.input ?? 0,
			modelCostOutput: model?.cost?.output ?? 0,
			thinkingLevel: thinking,
			contextTokens: ctx.getContextUsage()?.tokens,
			allTools: pi.getAllTools(),
			activeToolNames: pi.getActiveTools(),
		};
	}

	// ── Commands ──

	pi.registerCommand("dashboard", {
		description: "Open Pi Dashboard — web GUI with session stats, model info, tools & more",
		handler: async (_args, ctx) => {
			const data = getDashboardData(ctx);
			try {
				const port = await startServer(data);
				const url = `http://127.0.0.1:${port}`;
				openBrowser(url);
				ctx.ui.notify(`📊 Pi Dashboard opened at ${url}`, "info");
			} catch (err: any) {
				ctx.ui.notify(`Failed to start dashboard: ${err.message}`, "error");
			}
		},
	});

	pi.registerCommand("dash", {
		description: "Shorthand alias for /dashboard",
		handler: async (_args, ctx) => {
			const data = getDashboardData(ctx);
			try {
				const port = await startServer(data);
				const url = `http://127.0.0.1:${port}`;
				openBrowser(url);
				ctx.ui.notify(`📊 Pi Dashboard opened at ${url}`, "info");
			} catch (err: any) {
				ctx.ui.notify(`Failed to start dashboard: ${err.message}`, "error");
			}
		},
	});

	// ── Event tracking ──

	pi.on("turn_start", async () => {
		state.totalTurns++;
	});

	pi.on("tool_execution_start", async () => {
		state.totalToolCalls++;
	});

	// ── Footer status indicator ──

	pi.on("session_start", async (_event, ctx) => {
		const theme = ctx.ui.theme;
		const active = pi.getActiveTools();
		ctx.ui.setStatus(
			"dashboard",
			theme.fg("dim", "📊 ") +
				theme.fg("accent", "仪表盘") +
				theme.fg("dim", ` │ ${active.length} 工具 │ /dashboard`),
		);
	});
}

// ═══════════════════════════════════════════════════════════════════════
//  HTML TEMPLATE — Inlined for self-contained extension
// ═══════════════════════════════════════════════════════════════════════

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pi 仪表盘</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
/* ─── Reset & Base ─────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg-deep: #06080F;
  --bg-surface: #0B0E17;
  --bg-card: #111422;
  --bg-card-hover: #161A2E;
  --bg-elevated: #1A1F35;
  --border: #1E2340;
  --border-light: #2A3055;
  --text-primary: #EEF2FF;
  --text-secondary: #94A3B8;
  --text-muted: #4B5580;
  --accent-blue: #3B82F6;
  --accent-cyan: #22D3EE;
  --accent-green: #22C55E;
  --accent-amber: #F59E0B;
  --accent-purple: #A78BFA;
  --accent-red: #EF4444;
  --accent-pink: #EC4899;
  --glow-blue: 0 0 20px rgba(59,130,246,0.12);
  --glow-green: 0 0 20px rgba(34,197,94,0.10);
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
}
html, body { height: 100%; margin: 0; }
html { font-size: 15px; }
body {
  font-family: var(--font-sans);
  background: var(--bg-deep);
  color: var(--text-primary);
  min-height: 100vh;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  display: flex; flex-direction: column;
}
/* ─── Scrollbar ──────────────────────────────────────────────── */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-light); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

/* ─── Layout ──────────────────────────────────────────────────── */
.app { max-width: 1320px; margin: 0 auto; padding: 24px 32px 64px; display: flex; flex-direction: column; min-height: 100vh; box-sizing: border-box; }
@media (max-width: 768px) { .app { padding: 16px 16px 48px; } }

/* ─── Header ──────────────────────────────────────────────────── */
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 28px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  margin-bottom: 24px;
  position: relative;
  overflow: hidden;
}
.header::before {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(135deg, rgba(59,130,246,0.06), transparent 50%);
  pointer-events: none;
}
.header-left { display: flex; align-items: center; gap: 16px; }
.header-icon {
  width: 44px; height: 44px;
  background: linear-gradient(135deg, var(--accent-blue), var(--accent-cyan));
  border-radius: var(--radius-md);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; font-weight: 700;
  box-shadow: var(--glow-blue);
}
.header-title { font-size: 1.35rem; font-weight: 700; letter-spacing: -0.01em; }
.header-title span { color: var(--accent-cyan); }
.header-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 20px;
  font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
  background: rgba(34,197,94,0.12); color: var(--accent-green);
  border: 1px solid rgba(34,197,94,0.2);
}
.header-badge .dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent-green);
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.header-time { font-size: 0.8rem; color: var(--text-muted); font-family: var(--font-mono); }
@media (max-width: 600px) {
  .header { flex-direction: column; align-items: flex-start; gap: 12px; }
}

/* ─── Grid ────────────────────────────────────────────────────── */
.grid { display: grid; gap: 20px; }
.grid-2 { grid-template-columns: 1fr 1fr; }
.grid-3 { grid-template-columns: 1fr 1fr 1fr; }
.grid-4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
@media (max-width: 1100px) { .grid-4 { grid-template-columns: 1fr 1fr; } }
@media (max-width: 768px) { .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; } }

/* ─── Cards ───────────────────────────────────────────────────── */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.card:hover { border-color: var(--border-light); }
.card-header {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.card-icon {
  width: 32px; height: 32px; border-radius: var(--radius-sm);
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; flex-shrink: 0;
}
.card-icon.blue { background: rgba(59,130,246,0.15); }
.card-icon.green { background: rgba(34,197,94,0.15); }
.card-icon.purple { background: rgba(167,139,250,0.15); }
.card-icon.amber { background: rgba(245,158,11,0.15); }
.card-icon.red { background: rgba(239,68,68,0.15); }
.card-icon.cyan { background: rgba(34,211,238,0.15); }
.card-title { font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); }

/* ─── Stat rows ───────────────────────────────────────────────── */
.stat-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0;
}
.stat-row + .stat-row { border-top: 1px solid var(--border); }
.stat-label { font-size: 0.82rem; color: var(--text-secondary); }
.stat-value {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

/* ─── Model card ──────────────────────────────────────────────── */
.model-provider {
  display: flex; align-items: center; gap: 12px;
  padding: 16px; margin-bottom: 12px;
  background: var(--bg-surface); border-radius: var(--radius-md);
  border: 1px solid var(--border);
}
.model-provider-icon {
  width: 40px; height: 40px; border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 700; color: var(--accent-cyan);
  font-family: var(--font-mono);
}
.model-provider-name { font-weight: 600; font-size: 0.95rem; }
.model-provider-id { font-size: 0.78rem; color: var(--text-muted); font-family: var(--font-mono); }

.model-detail {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0;
  font-size: 0.82rem;
}
.model-detail .label { color: var(--text-secondary); min-width: 90px; }
.model-detail .value { font-family: var(--font-mono); font-weight: 500; }
.model-detail .sep { color: var(--text-muted); }

/* ─── 思考等级标签 ──────────────────────────────────────────── */
.thinking-badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 10px; border-radius: 12px;
  font-size: 0.72rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.03em;
}
.thinking-badge.off { background: rgba(75,85,128,0.2); color: var(--text-muted); }
.thinking-badge.minimal { background: rgba(148,163,184,0.15); color: var(--text-secondary); }
.thinking-badge.low { background: rgba(34,197,94,0.15); color: var(--accent-green); }
.thinking-badge.medium { background: rgba(245,158,11,0.15); color: var(--accent-amber); }
.thinking-badge.high { background: rgba(167,139,250,0.15); color: var(--accent-purple); }
.thinking-badge.xhigh { background: rgba(239,68,68,0.15); color: var(--accent-red); }

/* ─── Tools list ──────────────────────────────────────────────── */
.tool-item {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  transition: background 0.15s;
  cursor: pointer;
}
.tool-item:hover { background: var(--bg-card-hover); }
.tool-toggle {
  width: 36px; height: 20px; border-radius: 10px;
  position: relative; flex-shrink: 0;
  transition: background 0.2s;
  border: none; cursor: pointer;
}
.tool-toggle.on { background: var(--accent-green); }
.tool-toggle.off { background: var(--border-light); }
.tool-toggle::after {
  content: ''; position: absolute; top: 2px;
  width: 16px; height: 16px; border-radius: 50%;
  background: white; transition: left 0.2s;
}
.tool-toggle.on::after { left: 18px; }
.tool-toggle.off::after { left: 2px; }
.tool-name { font-size: 0.85rem; font-weight: 500; flex: 1; }
.tool-desc { font-size: 0.75rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px; }

/* ─── Quick actions ───────────────────────────────────────────── */
.quick-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.qa-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 18px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.85rem; font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  text-decoration: none;
  font-family: var(--font-sans);
}
.qa-btn:hover {
  border-color: var(--accent-blue);
  background: rgba(59,130,246,0.08);
  box-shadow: var(--glow-blue);
}
.qa-btn .key {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 24px; height: 22px;
  padding: 0 6px;
  background: var(--bg-elevated); border-radius: 4px;
  font-size: 0.72rem; font-weight: 700; font-family: var(--font-mono);
  color: var(--accent-cyan);
}

/* ─── 会话信息 ──────────────────────────────────────────────── */
.session-path {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--text-muted);
  word-break: break-all;
  padding: 8px 12px;
  background: var(--bg-surface);
  border-radius: var(--radius-sm);
  margin-top: 8px;
}

/* ─── Empty state ─────────────────────────────────────────────── */
.empty-state { padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem; }

/* ─── Footer ──────────────────────────────────────────────────── */
.footer {
  margin-top: 32px; padding-top: 20px;
  border-top: 1px solid var(--border);
  display: flex; justify-content: space-between; align-items: center;
  font-size: 0.75rem; color: var(--text-muted);
}
.footer a { color: var(--accent-blue); text-decoration: none; }
.footer a:hover { text-decoration: underline; }
@media (max-width: 600px) { .footer { flex-direction: column; gap: 8px; align-items: flex-start; } }

/* ─── Toast notification ──────────────────────────────────────── */
.toast {
  position: fixed; bottom: 24px; right: 24px;
  padding: 12px 20px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  font-size: 0.82rem;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  transform: translateY(100px);
  opacity: 0;
  transition: transform 0.3s ease, opacity 0.3s ease;
  z-index: 100;
}
.toast.show { transform: translateY(0); opacity: 1; }

/* ─── Loading shimmer ─────────────────────────────────────────── */
.loading {
  display: flex; align-items: center; justify-content: center;
  padding: 48px; color: var(--text-muted); gap: 12px;
}
.spinner {
  width: 20px; height: 20px;
  border: 2px solid var(--border); border-top-color: var(--accent-blue);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ─── Chat panel ────────────────────────────────────────────── */
.chat-container { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.chat-messages { flex: 1; overflow-y: auto; padding: 16px 0; display: flex; flex-direction: column; gap: 12px; }
.chat-msg { max-width: 80%; padding: 10px 16px; border-radius: var(--radius-md); font-size: 0.88rem; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; }
.chat-msg.user { align-self: flex-end; background: var(--accent-blue); color: white; border-bottom-right-radius: 4px; }
.chat-msg.assistant { align-self: flex-start; background: var(--bg-elevated); border: 1px solid var(--border); border-bottom-left-radius: 4px; color: var(--text-primary); }
.chat-msg.assistant.streaming { border-color: var(--accent-cyan); }
.chat-msg .timestamp { font-size: 0.65rem; color: var(--text-muted); margin-top: 4px; opacity: 0.7; }
.chat-msg.user .timestamp { color: rgba(255,255,255,0.7); }
.chat-input-area { display: flex; gap: 10px; padding: 16px 0; border-top: 1px solid var(--border); }
.chat-input { flex: 1; padding: 12px 16px; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-primary); font-size: 0.88rem; font-family: var(--font-sans); outline: none; transition: border-color 0.2s; }
.chat-input:focus { border-color: var(--accent-blue); box-shadow: var(--glow-blue); }
.chat-input::placeholder { color: var(--text-muted); }
.chat-send-btn { padding: 12px 24px; border-radius: var(--radius-md); border: none; background: var(--accent-blue); color: white; font-weight: 600; font-size: 0.85rem; cursor: pointer; transition: all 0.15s; font-family: var(--font-sans); }
.chat-send-btn:hover { background: #2563EB; box-shadow: var(--glow-blue); }
.chat-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.chat-thinking { align-self: flex-start; display: flex; align-items: center; gap: 8px; padding: 8px 16px; color: var(--text-muted); font-size: 0.82rem; }
.chat-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent-cyan); animation: chatPulse 1.2s ease-in-out infinite; }
.chat-dot:nth-child(2) { animation-delay: 0.2s; }
.chat-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes chatPulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
</style>
</head>
<body>
<div class="app" id="app">
  <div class="loading"><div class="spinner"></div> 加载仪表盘中...</div>
</div>

<div class="toast" id="toast"></div>

<script>
// ─── State ──────────────────────────────────────────────────────
let data = null;
let loading = true;
let viewMode = 'dashboard'; // 'dashboard' | 'chat'
let chatMessages = [];
let chatStreamId = null;
let isChatLoading = false;

// ─── DOM refs ───────────────────────────────────────────────────
const $app = document.getElementById('app');
const $toast = document.getElementById('toast');
let toastTimer = null;

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 3000);
}

// ─── Helpers ──────────────────────────────────────────────────
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function formatRuntime(startTime) {
  const s = Math.floor((Date.now() - startTime) / 1000);
  if (s < 60) return s + '秒';
  if (s < 3600) return Math.floor(s / 60) + '分' + (s % 60) + '秒';
  return Math.floor(s / 3600) + '时' + Math.floor((s % 3600) / 60) + '分';
}

function formatCost(tokens, costPer1kInput) {
  if (tokens == null) return '无数据';
  return '$' + ((tokens / 1000000) * costPer1kInput * 1000).toFixed(6);
}

function thinkingClass(level) {
  return (level || 'off').toLowerCase();
}

function timeAgo(startTime) {
  const elapsed = Date.now() - startTime;
  const s = Math.floor(elapsed / 1000);
  if (s < 60) return s + '秒前';
  if (s < 3600) return Math.floor(s / 60) + '分' + (s % 60) + '秒前';
  return Math.floor(s / 3600) + '时' + Math.floor((s % 3600) / 60) + '分前';
}

// ─── Render ─────────────────────────────────────────────────────
function render() {
  if (viewMode === 'chat') {
    renderChat();
    return;
  }
  if (!data || loading) {
    $app.innerHTML = '<div class="loading"><div class="spinner"></div> 加载仪表盘中...</div>';
    return;
  }
  const d = data;
  const p = d.modelProvider || '未知';
  const m = d.modelId || '未知';
  const ctx = d.modelContextWindow;
  const mxt = d.modelMaxTokens;
  const thinking = d.thinkingLevel || 'off';
  const runtime = formatRuntime(d.state.sessionStartTime);

  // Cap tools to show (show first 20 by default)
  const tools = d.allTools || [];
  const activeSet = new Set(d.activeToolNames || []);
  const MAX_TOOLS = 50;

  // ─── Build HTML ─────────────────────────────────────────────
  let html = '';

  // Header
  html += '<header class="header">';
  html += '  <div class="header-left">';
  html += '    <div class="header-icon">π</div>';
  html += '    <div>';
  html += '      <div class="header-title">Pi <span>仪表盘</span></div>';
  html += '    </div>';
  html += '  </div>';
  html += '  <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">';
  html += '    <div class="header-badge"><span class="dot"></span> 实时</div>';
  html += '    <div class="header-time">' + esc(timeAgo(d.state.sessionStartTime)) + '</div>';
  html += '  </div>';
  html += '</header>';

  // ── Stats + Model Row ─────────────────────────────────────
  html += '<div class="grid grid-2" style="margin-bottom:20px;">';

  // Session Stats Card
  html += '  <div class="card">';
  html += '    <div class="card-header"><div class="card-icon blue">📊</div><div class="card-title">会话</div></div>';
  html += '    <div class="stat-row"><span class="stat-label">运行时间</span><span class="stat-value">' + esc(runtime) + '</span></div>';
  html += '    <div class="stat-row"><span class="stat-label">消息数</span><span class="stat-value">' + esc(d.branchLength) + '</span></div>';
  html += '    <div class="stat-row"><span class="stat-label">对话轮次</span><span class="stat-value">' + esc(d.state.totalTurns) + '</span></div>';
  html += '    <div class="stat-row"><span class="stat-label">工具调用</span><span class="stat-value">' + esc(d.state.totalToolCalls) + '</span></div>';
  html += '    <div class="stat-row"><span class="stat-label">上下文</span><span class="stat-value">' + (d.contextTokens != null ? esc((d.contextTokens / 1000).toFixed(1)) + 'k token' : '无') + '</span></div>';
  html += '    <div class="stat-row"><span class="stat-label">预估费用</span><span class="stat-value">' + esc(formatCost(d.contextTokens, d.modelCostInput)) + '</span></div>';
  html += '  </div>';

  // Model Card
  html += '  <div class="card">';
  html += '    <div class="card-header"><div class="card-icon cyan">🤖</div><div class="card-title">模型</div></div>';
  html += '    <div class="model-provider">';
  html += '      <div class="model-provider-icon">' + esc(p.charAt(0).toUpperCase()) + '</div>';
  html += '      <div><div class="model-provider-name">' + esc(p) + '</div><div class="model-provider-id">' + esc(m) + '</div></div>';
  html += '    </div>';
  html += '    <div class="model-detail"><span class="label">上下文窗口</span><span class="value">' + esc(ctx) + '</span><span class="sep">·</span><span class="label">最大输出</span><span class="value">' + esc(mxt) + '</span></div>';
  html += '    <div class="model-detail"><span class="label">思考等级</span><span class="thinking-badge ' + thinkingClass(thinking) + '">' + esc(thinking) + '</span></div>';
  html += '    <div class="model-detail"><span class="label">输入价格</span><span class="value">$' + ((d.modelCostInput * 1000) || 0).toFixed(6) + '/1k token</span><span class="sep">·</span><span class="label">输出价格</span><span class="value">$' + ((d.modelCostOutput * 1000) || 0).toFixed(6) + '/1k token</span></div>';
  html += '  </div>';

  html += '</div>';

  // ── Tools + Quick Actions Row ──────────────────────────────
  html += '<div class="grid grid-2" style="margin-bottom:20px;">';

  // Tools Card
  html += '  <div class="card">';
  html += '    <div class="card-header"><div class="card-icon green">🔧</div><div class="card-title">工具 <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem;text-transform:none;">(' + esc(activeSet.size) + '/' + esc(tools.length) + ' 已启用)</span></div></div>';
  html += '    <div style="max-height:320px;overflow-y:auto;margin:-4px;">';

  if (tools.length === 0) {
    html += '      <div class="empty-state">暂无可用工具</div>';
  } else {
    const shown = tools.slice(0, MAX_TOOLS);
    for (const tool of shown) {
      const enabled = activeSet.has(tool.name);
      const desc = tool.description || '';
      html += '    <div class="tool-item">';
      html += '      <div class="tool-toggle ' + (enabled ? 'on' : 'off') + '" onclick="void(0)"></div>';
      html += '      <div><div class="tool-name" style="color:' + (enabled ? 'var(--text-primary)' : 'var(--text-muted)') + '">' + esc(tool.name) + '</div>';
      if (desc) html += '<div class="tool-desc">' + esc(desc) + '</div>';
      html += '      </div></div>';
    }
    if (tools.length > MAX_TOOLS) {
      html += '    <div class="empty-state" style="padding:12px;">+' + (tools.length - MAX_TOOLS) + ' 个更多工具</div>';
    }
  }

  html += '    </div>';
  html += '  </div>';

  // Quick Actions Card
  html += '  <div class="card">';
  html += '    <div class="card-header"><div class="card-icon amber">⚡</div><div class="card-title">快捷操作</div></div>';
  html += '    <div class="quick-actions">';
  html += '      <button class="qa-btn" onclick="piAction(\\'tool-config\\')"><span class="key">1</span> 工具配置</button>';
  html += '      <button class="qa-btn" onclick="piAction(\\'model-info\\')"><span class="key">2</span> 模型信息</button>';
  html += '      <button class="qa-btn" onclick="piAction(\\'session-manager\\')"><span class="key">3</span> 会话管理</button>';
  html += '      <button class="qa-btn" onclick="piAction(\\'about\\')"><span class="key">4</span> 关于 Pi</button>';
  html += '      <button class="qa-btn" onclick="piAction(\\'new-session\\')"><span class="key">N</span> 新建会话</button>';
  html += '      <button class="qa-btn" onclick="piAction(\\'compact\\')"><span class="key">C</span> 压缩上下文</button>';
  html += '      <button class="qa-btn" onclick="switchToChat()" style="border-color:var(--accent-cyan);"><span class="key" style="color:var(--accent-cyan);">💬</span> 对话 Pi</button>';
  html += '    </div>';
  html += '    <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">';
  html += '      <div class="stat-row"><span class="stat-label">会话文件</span></div>';
  html += '      <div class="session-path">' + (d.sessionFile ? esc(d.sessionFile) : '临时会话（未保存）') + '</div>';
  html += '    </div>';
  html += '  </div>';

  html += '</div>';

  // ── Footer ─────────────────────────────────────────────────
  html += '<div class="footer">';
  html += '  <span>Pi 仪表盘 · <a href="#" onclick="location.reload()">刷新</a></span>';
  html += '  <span>使用完毕可关闭此页面 · 每3秒自动更新</span>';
  html += '</div>';

  $app.innerHTML = html;
}

// ─── Pi action (placeholder: show toast) ─────────────────────────
function piAction(action) {
  toast('🔧 操作 "' + action + '" — 请在 pi 终端中执行');
}

// ─── Chat ────────────────────────────────────────────────────────
function switchToChat() {
  viewMode = 'chat';
  render();
  requestAnimationFrame(() => {
    const input = document.getElementById('chat-input');
    if (input) { input.focus(); input.selectionStart = input.selectionEnd = input.value.length; }
  });
}

function switchToDashboard() {
  viewMode = 'dashboard';
  render();
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input || !input.value.trim() || isChatLoading) return;
  const text = input.value.trim();
  input.value = '';
  chatMessages.push({ role: 'user', content: text });
  isChatLoading = true;
  renderChat();
  scrollChat();

  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
  })
  .then(r => r.json())
  .then(res => {
    chatStreamId = res.streamId;
    chatMessages.push({ role: 'assistant', content: '', streaming: true });
    const idx = chatMessages.length - 1;
    const evtSource = new EventSource('/api/chat/stream/' + chatStreamId);
    evtSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'delta') {
        chatMessages[idx].content += data.text;
        renderChat();
        scrollChat();
      } else if (data.type === 'done') {
        chatMessages[idx].streaming = false;
        chatMessages[idx].content = data.text;
        isChatLoading = false;
        chatStreamId = null;
        evtSource.close();
        renderChat();
        scrollChat();
      }
    };
    evtSource.onerror = () => {
      if (chatMessages[idx] && chatMessages[idx].streaming) {
        chatMessages[idx].streaming = false;
        isChatLoading = false;
        chatStreamId = null;
        evtSource.close();
        renderChat();
      }
    };
  })
  .catch(err => {
    isChatLoading = false;
    toast('发送失败: ' + err.message);
    renderChat();
  });
}

function scrollChat() {
  const container = document.getElementById('chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

// ─── Render Chat ───────────────────────────────────────────────
function renderChat() {
  // Build messages HTML
  let msgsHtml = '';
  if (chatMessages.length === 0) {
    msgsHtml += '    <div class="empty-state" style="padding:48px 24px;">';
    msgsHtml += '      <div style="font-size:2rem;margin-bottom:12px;">💬</div>';
    msgsHtml += '      <div style="font-size:1rem;font-weight:600;margin-bottom:8px;">开始对话</div>';
    msgsHtml += '      <div style="font-size:0.85rem;color:var(--text-muted);">直接在浏览器中与 Pi 交谈，消息会同步到终端会话</div>';
    msgsHtml += '    </div>';
  } else {
    for (const msg of chatMessages) {
      const cls = msg.role === 'user' ? 'user' : 'assistant' + (msg.streaming ? ' streaming' : '');
      msgsHtml += '    <div class="chat-msg ' + cls + '">';
      msgsHtml += '      <div>' + esc(msg.content || ' ') + '</div>';
      if (msg.streaming) {
        msgsHtml += '      <div class="chat-thinking"><span class="chat-dot"></span><span class="chat-dot"></span><span class="chat-dot"></span></div>';
      }
      msgsHtml += '    </div>';
    }
  }

  // If chat container exists, only update messages (preserves input focus/state)
  const existingContainer = document.getElementById('chat-container');
  if (existingContainer) {
    const msgsDiv = document.getElementById('chat-messages');
    if (msgsDiv) msgsDiv.innerHTML = msgsHtml;
    scrollChat();
    return;
  }

  // First time: render full layout
  let html = '';
  // Header
  html += '<header class="header">';
  html += '  <div class="header-left">';
  html += '    <div class="header-icon" onclick="switchToDashboard()" style="cursor:pointer;">←</div>';
  html += '    <div>';
  html += '      <div class="header-title">💬 对话 <span>Pi</span></div>';
  html += '      <div style="font-size:0.75rem;color:var(--text-muted);">在 GUI 中直接与我对话</div>';
  html += '    </div>';
  html += '  </div>';
  html += '  <div style="display:flex;align-items:center;gap:12px;">';
  html += '    <button class="qa-btn" onclick="switchToDashboard()" style="padding:6px 14px;font-size:0.78rem;">← 返回仪表盘</button>';
  html += '  </div>';
  html += '</header>';

  // Chat container with messages and input
  html += '<div class="chat-container" id="chat-container">';
  html += '  <div class="chat-messages" id="chat-messages">' + msgsHtml + '  </div>';
  html += '  <div class="chat-input-area">';
  html += '    <input class="chat-input" id="chat-input" type="text" placeholder="输入消息，回车发送..." autocomplete="off" ' + (isChatLoading ? 'disabled' : '') + ' onkeydown="handleChatKey(event)">';
  html += '    <button class="chat-send-btn" onclick="sendChatMessage()" ' + (isChatLoading ? 'disabled' : '') + '>' + (isChatLoading ? '发送中...' : '发送') + '</button>';
  html += '  </div>';
  html += '</div>';

  $app.innerHTML = html;
  requestAnimationFrame(() => {
    scrollChat();
    const input = document.getElementById('chat-input');
    if (input && !isChatLoading) input.focus();
  });
}

// ─── Fetch data ──────────────────────────────────────────────────
async function fetchData() {
  try {
    const res = await fetch('/api/dashboard');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
    loading = false;
    render();
  } catch (err) {
    if (loading) {
      $app.innerHTML = '<div class="loading" style="color:var(--accent-red)">⚠ 仪表盘加载失败：' + esc(err.message) + '</div>';
    }
  }
}

// ─── SSE live updates ────────────────────────────────────────────
function connectSSE() {
  const evtSource = new EventSource('/api/stream');
  evtSource.onmessage = (event) => {
    try {
      data = JSON.parse(event.data);
      loading = false;
      render();
    } catch { /* ignore parse errors */ }
  };
  evtSource.onerror = () => {
    evtSource.close();
    // Fallback to polling
  };
}

// ─── Init ────────────────────────────────────────────────────────
connectSSE();
// Also poll as fallback
setInterval(fetchData, 3000);
fetchData();
</script>
</body>
</html>`;
