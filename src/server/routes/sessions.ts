/**
 * Session routes — CRUD for conversation sessions
 */
import type { RouteHandler } from "./types";
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, statSync, mkdirSync, renameSync } from "fs";
import { resolve, basename, dirname } from "path";

const cors = { "Access-Control-Allow-Origin": "*" };

/** 取目录名（路径最后一段），用作workspace key */
export function wsKey(workspace: string): string {
  if (!workspace) return "_default";
  const normalized = workspace.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || "_default";
}

/** 按workspace分目录存储：baseDir/by-project/<dir-name>/ */
export function wsDir(baseDir: string, workspace: string): string {
  if (!workspace) return baseDir;
  return resolve(baseDir, "by-project", wsKey(workspace));
}

/** 迁移会话: 从 sessions/ 根目录按 workspace 分类移入 by-project/ */
function migrateOldSessions(baseDir: string): void {
  const entries = readdirSync(baseDir, { withFileTypes: true });
  let moved = 0;
  for (const e of entries) {
    if (e.name === "by-project") continue;
    if (!e.name.endsWith(".jsonl")) continue;
    const fp = resolve(baseDir, e.name);
    try {
      const content = readFileSync(fp, "utf-8");
      const header = JSON.parse(content.trim().split("\n")[0] || "{}");
      const ws = header.workspace || "";
      const targetDir = ws ? wsDir(baseDir, ws) : resolve(baseDir, "by-project", "_legacy");
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      renameSync(fp, resolve(targetDir, e.name));
      moved++;
    } catch {}
  }
  if (moved > 0) console.log(`📦 Migrated ${moved} session(s) to by-project/`);
}

/** 扫描所有项目的session目录 */
function findAllProjectDirs(baseDir: string): string[] {
  const projectsDir = resolve(baseDir, "by-project");
  if (!existsSync(projectsDir)) return [];
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => resolve(projectsDir, d.name));
}

function fixSurrogates(s: string): string {
  return s.replace(/[\uD800-\uDBFF]([^\uDC00-\uDFFF]|$)/g, "").replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, "");
}

export function findAllJsonl(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) files.push(...findAllJsonl(resolve(dir, e.name)));
    else if (e.name.endsWith(".jsonl")) files.push(resolve(dir, e.name));
  }
  return files;
}

function findSessionFileById(baseDir: string, id: string): string | null {
  // Search all session files by reading header ID
  const searchDirs = [baseDir, resolve(baseDir, "by-project")];
  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        // Recurse into subdirectories
        const found = findSessionFileById(resolve(dir, e.name), id);
        if (found) return found;
      } else if (e.name.endsWith(".jsonl")) {
        const fp = resolve(dir, e.name);
        try {
          const headerLine = readFileSync(fp, "utf-8").trim().split("\n")[0];
          const header = JSON.parse(headerLine);
          if (header.id === id || e.name.includes(id)) return fp;
        } catch {}
      }
    }
  }
  return null;
}

function parseBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString(); });
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { reject(new Error("Invalid JSON")); } });
  });
}

export const handleSessions: RouteHandler = async (req, res, ctx) => {
  const { url, method } = req;
  const { session, paths: p } = ctx;

  // List sessions — filtered by workspace, with "other projects" section
  if ((url === "/api/sessions" || url?.startsWith("/api/sessions?")) && method === "GET") {
    try {
      // Migrate old flat sessions -> by-project/
      migrateOldSessions(p.SESSIONS_DIR);

      const u = new URL(url, `http://${req.headers.host || "localhost"}`);
      const currentWs = u.searchParams.get("workspace") || "";
      const includeOther = u.searchParams.get("other") === "1";
      const curId = (session as any).sessionManager?.getSessionId?.() ?? "";

      // Current workspace sessions dir
      const curSessionsDir = wsDir(p.SESSIONS_DIR, currentWs);
      if (!existsSync(p.SESSIONS_DIR)) mkdirSync(p.SESSIONS_DIR, { recursive: true });
      if (!existsSync(curSessionsDir)) mkdirSync(curSessionsDir, { recursive: true });

      // Helper to parse session from a dir
      function readSessionsFromDir(dir: string): any[] {
        if (!existsSync(dir)) return [];
        return findAllJsonl(dir).map((fullPath: string) => {
          const stat = existsSync(fullPath) ? statSync(fullPath) : null;
          const content = readFileSync(fullPath, "utf-8");
          const lines = content.trim().split("\n");
          const header = lines[0] ? JSON.parse(lines[0]) : {};
          const id = header.id || basename(fullPath, ".jsonl");
          let sessionName = "";
          for (const line of lines) {
            try { const entry = JSON.parse(line); if (entry.type === "session_info" && entry.name) sessionName = entry.name; } catch {}
          }
          return {
            id, name: sessionName, active: id === curId,
            messageCount: lines.filter((l: string) => l.includes('"type":"message"')).length,
            createdAt: stat?.birthtime?.toISOString() || header.timestamp || "",
            file: basename(fullPath),
            workspace: header.workspace || "",
          };
        }).sort((a: any, b: any) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      }

      const sessions = readSessionsFromDir(curSessionsDir);

      // Other projects
      let other: { project: string; path: string; sessions: any[] }[] = [];
      if (includeOther) {
        const allDirs = findAllProjectDirs(p.SESSIONS_DIR);
        const curKey = wsKey(currentWs);
        for (const dir of allDirs) {
          const projName = basename(dir);
          if (projName === curKey) continue;
          const projSessions = readSessionsFromDir(dir);
          if (projSessions.length > 0) {
            // Get workspace path from the first session's header
            const wsPath = projSessions[0]?.workspace || "";
            other.push({ project: projName === "_legacy" ? "未分类" : projName, path: wsPath, sessions: projSessions });
          }
        }
      }

      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ sessions, other }));
    } catch (err: any) {
      res.writeHead(200, { ...cors });
      res.end(JSON.stringify({ sessions: [], other: [], error: err.message }));
    }
    return true;
  }

  // Create new session
  if (url === "/api/sessions/new" && method === "POST") {
    try {
      const body = await parseBody(req).catch(() => ({}));
      const workspace = body.workspace || "";
      const targetDir = wsDir(p.SESSIONS_DIR, workspace);
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      const id = "sess-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      const header = JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: p.APP_ROOT, workspace });
      writeFileSync(resolve(targetDir, id + ".jsonl"), header + "\n");
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ ok: true, id }));
    } catch (err: any) {
      res.writeHead(400, { ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Migrate session to workspace (move from _legacy to project dir)
  if (url === "/api/sessions/migrate" && method === "POST") {
    try {
      const body = await parseBody(req);
      const { id, workspace } = body;
      const sFile = findSessionFileById(p.SESSIONS_DIR, id);
      if (!sFile) { res.writeHead(404, { ...cors }); res.end(JSON.stringify({ error: "not found" })); return true; }
      const targetDir = wsDir(p.SESSIONS_DIR, workspace || "");
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      const targetFile = resolve(targetDir, basename(sFile));
      // Read, tag, and move
      const content = readFileSync(sFile, "utf-8");
      const lines = content.trim().split("\n");
      const header = JSON.parse(lines[0]);
      header.workspace = workspace || "";
      lines[0] = JSON.stringify(header);
      writeFileSync(targetFile, lines.join("\n") + "\n");
      if (sFile !== targetFile) unlinkSync(sFile);
      console.log(`📦 Migrated session ${id} → by-project/${wsKey(workspace)}/`);
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.writeHead(400, { ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Save session (no-op, auto-saved by PI)
  if (url === "/api/sessions/save" && method === "POST") {
    res.writeHead(200, { ...cors });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // Get session messages
  if (method === "GET" && url?.startsWith("/api/sessions/") && url?.endsWith("/messages")) {
    try {
      const idMatch = url.match(/\/api\/sessions\/(.+?)\/messages/);
      const sessionId = idMatch ? idMatch[1] : "";
      const sessionFile = findSessionFileById(p.SESSIONS_DIR, sessionId);
      if (!sessionFile) {
        res.writeHead(404, { ...cors });
        res.end(JSON.stringify({ error: "not found" }));
        return true;
      }
      const content = readFileSync(sessionFile, "utf-8");
      const lines = content.trim().split("\n");
      const messages: { role: string; content: string }[] = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === "message" && entry.message) {
            const role = entry.message.role;
            const textContent = entry.message.content?.filter((c: any) => c.type === "text").map((c: any) => fixSurrogates(c.text)).join(" ").trim() || "";
            if (role && textContent) messages.push({ role, content: textContent });
          }
        } catch {}
      }
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ messages }));
    } catch (err: any) {
      res.writeHead(400, { ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Rename session
  if (url === "/api/sessions/rename" && method === "POST") {
    try {
      const { id, name } = await parseBody(req);
      const sessionFile = findSessionFileById(p.SESSIONS_DIR, id);
      if (sessionFile) {
        const content = readFileSync(sessionFile, "utf-8");
        const lines = content.trim().split("\n");
        const infoEntry = JSON.stringify({ type: "session_info", name, timestamp: new Date().toISOString() });
        lines.splice(1, 0, infoEntry);
        writeFileSync(sessionFile, lines.join("\n") + "\n");
      }
      res.writeHead(200, { ...cors });
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.writeHead(400, { ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Delete session
  if (url === "/api/sessions/delete" && method === "POST") {
    try {
      const { id } = await parseBody(req);
      const sessionFile = findSessionFileById(p.SESSIONS_DIR, id);
      if (sessionFile) unlinkSync(sessionFile);
      res.writeHead(200, { ...cors });
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.writeHead(400, { ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
};
