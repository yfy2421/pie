/**
 * Search route — filename & full-text search
 *
 * POST /api/search   Body: { query, root?, type, caseSensitive?, maxResults? }
 * GET  /api/search?q=...&type=filename&root=...
 */
import type { RouteHandler } from "./types";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, relative, sep } from "path";

const cors = { "Access-Control-Allow-Origin": "*" };

// ─── Types ───────────────────────────────────────────────────────

interface SearchMatch {
  line: number;
  column: number;
  text: string;
  length: number;
}

interface SearchResult {
  file: string;          // relative to root
  absolutePath: string;
  matches: SearchMatch[];
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  truncated: boolean;
}

// ─── Binary extensions & skip dirs ──────────────────────────────

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".pdf", ".zip", ".rar", ".7z", ".gz", ".tar",
  ".exe", ".dll", ".bin", ".o", ".a", ".so", ".dylib",
  ".mp3", ".mp4", ".avi", ".mov", ".wmv",
  ".pyc", ".class", ".jar",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".claude",
  "dist", "dist-electron", ".vscode", "data",
]);

const MAX_FILE_SIZE = 1 * 1024 * 1024;  // 1 MB

// ─── Helpers ─────────────────────────────────────────────────────

function isBinary(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return BINARY_EXT.has(ext);
}

function walkDir(
  dir: string,
  maxResults: number,
  collect: (fullPath: string) => void,
): boolean {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return false; }

  for (const name of entries) {
    const fullPath = resolve(dir, name);
    let st: ReturnType<typeof statSync>;
    try { st = statSync(fullPath); } catch { continue; }

    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      if (walkDir(fullPath, maxResults, collect)) return true;
    } else if (st.isFile() && st.size <= MAX_FILE_SIZE) {
      collect(fullPath);
    }
  }
  return false;
}

function matchFileName(name: string, query: string, cs: boolean): boolean {
  const n = cs ? name : name.toLowerCase();
  const q = cs ? query : query.toLowerCase();
  return n.includes(q);
}

function searchInFile(
  filePath: string,
  query: string,
  cs: boolean,
  maxPerFile = 50,
): SearchMatch[] {
  try {
    if (isBinary(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const matches: SearchMatch[] = [];
    const q = cs ? query : query.toLowerCase();

    for (let i = 0; i < lines.length && matches.length < maxPerFile; i++) {
      const line = lines[i];
      const testLine = cs ? line : line.toLowerCase();
      let idx = testLine.indexOf(q);
      while (idx !== -1 && matches.length < maxPerFile) {
        matches.push({ line: i + 1, column: idx + 1, text: line.slice(0, 200).trimEnd(), length: query.length });
        idx = testLine.indexOf(q, idx + 1);
      }
    }
    return matches;
  } catch { return []; }
}

// ─── Core search ─────────────────────────────────────────────────

function doSearch(
  q: string,
  rootDir: string,
  type: "filename" | "text",
  cs: boolean,
  maxResults: number,
): SearchResponse {
  const results: SearchResult[] = [];
  let truncated = false;

  walkDir(rootDir, maxResults, (fullPath) => {
    if (results.length >= maxResults) { truncated = true; return; }
    const name = fullPath.split(sep).pop() || "";

    if (type === "filename") {
      if (matchFileName(name, q, cs)) {
        results.push({ file: relative(rootDir, fullPath).replace(/\\/g, "/"), absolutePath: fullPath, matches: [] });
      }
      return;
    }

    // Text search
    const matches = searchInFile(fullPath, q, cs);
    if (matches.length > 0) {
      results.push({ file: relative(rootDir, fullPath).replace(/\\/g, "/"), absolutePath: fullPath, matches });
    }
  });

  return { results, total: results.reduce((s, r) => s + r.matches.length, 0), truncated };
}

function parseBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString(); });
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}

// ─── Route handler ──────────────────────────────────────────────

export const handleSearch: RouteHandler = async (req, res, ctx) => {
  const { url, method } = req;
  const { paths: p } = ctx;
  const cors = { "Access-Control-Allow-Origin": "*" };

  // GET /api/search?q=...&type=filename&root=...
  if (url?.startsWith("/api/search") && method === "GET") {
    try {
      const u = new URL(url!, `http://${req.headers.host || "localhost"}`);
      const q = u.searchParams.get("q") || "";
      if (!q) {
        res.writeHead(400, { ...cors });
        res.end(JSON.stringify({ error: "Missing 'q'" }));
        return true;
      }
      const data = doSearch(
        q,
        u.searchParams.get("root") || p.APP_ROOT,
        (u.searchParams.get("type") as any) || "filename",
        u.searchParams.get("caseSensitive") === "true",
        parseInt(u.searchParams.get("maxResults") || "200", 10) || 200,
      );
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(data));
    } catch (err: any) {
      res.writeHead(400, { ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // POST /api/search   Body: { query, root?, type?, caseSensitive?, maxResults? }
  if (url === "/api/search" && method === "POST") {
    try {
      const { query, root, type, caseSensitive, maxResults } = await parseBody(req);
      if (!query) {
        res.writeHead(400, { ...cors });
        res.end(JSON.stringify({ error: "Missing 'query'" }));
        return true;
      }
      const data = doSearch(
        query,
        root || p.APP_ROOT,
        type || "filename",
        caseSensitive || false,
        maxResults || 200,
      );
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify(data));
    } catch (err: any) {
      res.writeHead(400, { ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  return false;
};
