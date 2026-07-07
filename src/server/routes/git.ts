/**
 * Git routes — read-only git status & log
 *
 * GET /api/git/status?root=...
 * GET /api/git/log?root=...&count=10
 */
import type { RouteHandler } from "./types";
import { execSync } from "child_process";
import { resolve } from "path";
import { existsSync } from "fs";

const cors = { "Access-Control-Allow-Origin": "*" };

interface GitStatusEntry {
  x: string;        // index status
  y: string;        // working tree status
  path: string;     // file path
  renamePath?: string; // for renames
}

interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author?: string;
}

function findGitRoot(dir: string): string | null {
  let current = resolve(dir);
  for (let i = 0; i < 20; i++) {
    if (existsSync(resolve(current, ".git"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

function parsePorcelain(output: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    // --porcelain format: XY filename
    // For renames: XY orig -> new
    const x = line[0] || " ";
    const y = line[1] || " ";
    const rest = line.slice(3).trim();
    if (rest.includes(" -> ")) {
      const [orig, renamed] = rest.split(" -> ");
      entries.push({ x, y, path: orig.trim(), renamePath: renamed?.trim() });
    } else {
      entries.push({ x, y, path: rest });
    }
  }
  return entries;
}

function parseLog(output: string): GitLogEntry[] {
  const entries: GitLogEntry[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    // --oneline format: hash SP subject
    const spaceIdx = line.indexOf(" ");
    if (spaceIdx === -1) continue;
    entries.push({ hash: line.slice(0, spaceIdx), date: "", message: line.slice(spaceIdx + 1) });
  }
  return entries;
}

/** Get full log with dates for detail display */
function parseLogVerbose(output: string): GitLogEntry[] {
  const entries: GitLogEntry[] = [];
  let current: Partial<GitLogEntry> | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("commit ")) {
      if (current?.hash) entries.push(current as GitLogEntry);
      current = { hash: line.slice(7).trim() };
    } else if (line.startsWith("Date:") && current) {
      current.date = line.slice(5).trim();
    } else if (line.startsWith("    ") && current) {
      current.message = (current.message || "") + line.trim() + " ";
    }
  }
  if (current?.hash) entries.push(current as GitLogEntry);
  return entries;
}

const STATUS_LABELS: Record<string, string> = {
  M: "修改", A: "新增", D: "删除", R: "重命名",
  C: "复制", U: "未合并", "?": "未跟踪", "!": "忽略",
};

function statusLabel(code: string): string {
  return STATUS_LABELS[code] || code;
}

function parseBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c: Buffer) => body += c.toString());
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

export const handleGit: RouteHandler = async (req, res, ctx) => {
  const { url, method } = req;
  const { paths: p } = ctx;

  if (!url?.startsWith("/api/git/")) return false;

  const u = new URL(url, `http://${req.headers.host || "localhost"}`);
  const queryRoot = u.searchParams.get("root") || "";

  try {
    // GET /api/git/status
    if (url.startsWith("/api/git/status")) {
      const root = queryRoot || p.APP_ROOT;
      const gitRoot = findGitRoot(root);
      if (!gitRoot) {
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ error: "not_a_repo", message: "当前工作区不是 Git 仓库" }));
        return true;
      }
      const output = execSync("git status --porcelain", {
        cwd: gitRoot,
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const entries = parsePorcelain(output);
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({
        gitRoot,
        entries,
        total: entries.length,
        modified: entries.filter(e => e.y === "M" || e.x === "M").length,
        added: entries.filter(e => e.y === "?" || e.x === "A" || e.y === "A").length,
        deleted: entries.filter(e => e.x === "D" || e.y === "D").length,
      }));
      return true;
    }

    // GET /api/git/log
    if (url.startsWith("/api/git/log")) {
      const root = queryRoot || p.APP_ROOT;
      const gitRoot = findGitRoot(root);
      if (!gitRoot) {
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ error: "not_a_repo", message: "当前工作区不是 Git 仓库" }));
        return true;
      }
      const count = parseInt(u.searchParams.get("count") || "10", 10);
      const output = execSync(`git log --oneline -${count}`, {
        cwd: gitRoot,
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const entries = parseLog(output);
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ gitRoot, entries }));
      return true;
    }

    // POST /api/git/commit
    if (url.startsWith("/api/git/commit") && method === "POST") {
      const body = await parseBody(req);
      const msg = (body.message || "").trim();
      const bodyRoot = body.root || p.APP_ROOT;
      const gitRoot2 = findGitRoot(bodyRoot);
      if (!gitRoot2) {
        res.writeHead(200, { ...cors });
        res.end(JSON.stringify({ error: "not_a_repo", message: "当前工作区不是 Git 仓库" }));
        return true;
      }
      if (!msg) { res.writeHead(200, { ...cors }); res.end(JSON.stringify({ error: "empty_message", message: "提交信息不能为空" })); return true; }
      execSync(`git add -A`, { cwd: gitRoot2, encoding: "utf-8", timeout: 15000, stdio: "pipe" });
      execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: gitRoot2, encoding: "utf-8", timeout: 15000, stdio: "pipe" });
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ ok: true, message: "提交成功" }));
      return true;
    }

    // POST /api/git/push
    if (url.startsWith("/api/git/push") && method === "POST") {
      const body = await parseBody(req);
      const bodyRoot = body.root || p.APP_ROOT;
      const gitRoot2 = findGitRoot(bodyRoot);
      if (!gitRoot2) {
        res.writeHead(200, { ...cors });
        res.end(JSON.stringify({ error: "not_a_repo", message: "当前工作区不是 Git 仓库" }));
        return true;
      }
      try {
        execSync(`git push`, { cwd: gitRoot2, encoding: "utf-8", timeout: 60000, stdio: "pipe" });
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ ok: true, message: "推送成功" }));
      } catch (pushErr: any) {
        const errMsg = pushErr.stderr?.toString() || pushErr.message || "推送失败";
        res.writeHead(200, { ...cors });
        res.end(JSON.stringify({ error: "push_error", message: errMsg }));
      }
      return true;
    }

    // POST /api/git/pull
    if (url.startsWith("/api/git/pull") && method === "POST") {
      const body = await parseBody(req);
      const bodyRoot = body.root || p.APP_ROOT;
      const gitRoot2 = findGitRoot(bodyRoot);
      if (!gitRoot2) {
        res.writeHead(200, { ...cors });
        res.end(JSON.stringify({ error: "not_a_repo", message: "当前工作区不是 Git 仓库" }));
        return true;
      }
      try {
        execSync(`git pull`, { cwd: gitRoot2, encoding: "utf-8", timeout: 60000, stdio: "pipe" });
        res.writeHead(200, { "Content-Type": "application/json", ...cors });
        res.end(JSON.stringify({ ok: true, message: "拉取成功" }));
      } catch (pullErr: any) {
        const errMsg = pullErr.stderr?.toString() || pullErr.message || "拉取失败";
        res.writeHead(200, { ...cors });
        res.end(JSON.stringify({ error: "pull_error", message: errMsg }));
      }
      return true;
    }
  } catch (e: any) {
    res.writeHead(200, { ...cors });
    res.end(JSON.stringify({ error: e.message?.includes("not a git repository") ? "not_a_repo" : "git_error", message: e.message }));
    return true;
  }

  return false;
};

// Exported for reuse elsewhere
export { findGitRoot, statusLabel };
