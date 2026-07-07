/**
 * Explorer routes — file system browsing and operations
 */
import type { RouteHandler } from "./types";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, renameSync, rmSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

const cors = { "Access-Control-Allow-Origin": "*" };

// ─── .gitignore parser (simplified) ───────────────────────────────
function loadGitignore(dir: string): ((name: string, isDir: boolean) => boolean) | null {
  const giFile = resolve(dir, ".gitignore");
  if (!existsSync(giFile)) return null;
  const content = readFileSync(giFile, "utf-8");
  const patterns: { negate: boolean; pattern: string; dirOnly: boolean; anchored: boolean }[] = [];
  for (let line of content.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    const anchored = line.startsWith("/");
    const pattern = (anchored || dirOnly) ? line.replace(/^\/|\/$/g, "") : line;
    patterns.push({ negate, pattern, dirOnly, anchored });
  }
  return (name: string, isDir: boolean): boolean => {
    let ignored: boolean | null = null;
    for (const p of patterns) {
      if (p.dirOnly && !isDir) continue;
      const match = matchGitignore(p.pattern, name);
      if (match) ignored = !p.negate;
    }
    return ignored ?? false;
  };
}

function matchGitignore(pattern: string, name: string): boolean {
  if (pattern === name) return true;
  const reStr = "^" + pattern.replace(/\./g, "\\.").replace(/\*\*/g, "@@").replace(/\*/g, "[^/]*").replace(/@@/g, ".*") + "$";
  try { return new RegExp(reStr).test(name); } catch { return false; }
}

function parseFileOpBody(req: any): Promise<{ root: string; path: string; newPath?: string }> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString(); });
    req.on("end", () => { try { resolve(JSON.parse(body)); } catch { reject(new Error("Invalid JSON")); } });
  });
}

export const handleExplorer: RouteHandler = async (req, res, ctx) => {
  const { url, method } = req;
  const { paths: p } = ctx;

  // List directory contents
  if (url?.startsWith("/api/explorer") && method === "GET") {
    try {
      const parsedUrl = new URL(url, `http://${req.headers.host || "localhost"}`);
      const rootDir = parsedUrl.searchParams.get("root") || p.APP_ROOT;
      const rawPath = parsedUrl.searchParams.get("path") || "";
      const targetDir = rawPath ? resolve(rootDir, rawPath) : rootDir;

      if (!targetDir.startsWith(rootDir)) {
        res.writeHead(403, { ...cors });
        res.end(JSON.stringify({ error: "Access denied" }));
        return true;
      }
      if (!existsSync(targetDir)) {
        res.writeHead(404, { ...cors });
        res.end(JSON.stringify({ error: "目录不存在: " + targetDir }));
        return true;
      }

      const entries = readdirSync(targetDir, { withFileTypes: true });
      const doFilter = parsedUrl.searchParams.get("filter") === "1";
      const giFilter = doFilter ? loadGitignore(targetDir) : null;

      const items = entries
        .filter(e => {
          if (!doFilter) return true;
          if (e.name.startsWith(".") && e.name !== ".gitignore") return false;
          if (e.name === "node_modules" && e.isDirectory()) return false;
          if (giFilter && giFilter(e.name, e.isDirectory())) return false;
          return true;
        })
        .map(e => ({
          name: e.name,
          path: rawPath ? rawPath + "/" + e.name : e.name,
          isDir: e.isDirectory(),
        }));
      items.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ rootDir, relativePath: rawPath || "", items }));
    } catch (err: any) {
      res.writeHead(400, { ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Read file content
  if (url?.startsWith("/api/file/read") && method === "GET") {
    try {
      const parsedUrl = new URL(url, `http://${req.headers.host || "localhost"}`);
      const filePath = parsedUrl.searchParams.get("path") || "";
      const rootDir = parsedUrl.searchParams.get("root") || p.APP_ROOT;
      const resolvedPath = resolve(rootDir, filePath);

      if (!resolvedPath.startsWith(rootDir)) {
        res.writeHead(403, { ...cors });
        res.end(JSON.stringify({ error: "Access denied" }));
        return true;
      }
      if (!existsSync(resolvedPath)) {
        res.writeHead(404, { ...cors });
        res.end(JSON.stringify({ error: "File not found" }));
        return true;
      }
      if (statSync(resolvedPath).isDirectory()) {
        res.writeHead(400, { ...cors });
        res.end(JSON.stringify({ error: "Is a directory" }));
        return true;
      }

      const binExt = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".otf", ".pdf", ".zip", ".rar", ".7z", ".exe", ".dll", ".bin", ".o", ".a", ".so", ".dylib"]);
      const ext = resolvedPath.slice(resolvedPath.lastIndexOf(".")).toLowerCase();
      const isText = !binExt.has(ext);

      const content = isText ? readFileSync(resolvedPath, "utf-8") : readFileSync(resolvedPath, "base64");
      const encoding = isText ? "text" : "base64";

      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ content, encoding, path: resolvedPath, size: statSync(resolvedPath).size }));
    } catch (err: any) {
      res.writeHead(500, { ...cors });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Create file/folder
  if (url?.startsWith("/api/file/new") && method === "POST") {
    try {
      const { root, path } = await parseFileOpBody(req);
      const fullPath = resolve(root, path);
      if (!fullPath.startsWith(resolve(root))) { res.writeHead(403, { ...cors }); res.end(JSON.stringify({ error: "Access denied" })); return true; }
      if (path.endsWith("/")) mkdirSync(fullPath, { recursive: true });
      else { mkdirSync(dirname(fullPath), { recursive: true }); writeFileSync(fullPath, "", "utf-8"); }
      res.writeHead(200, { ...cors }); res.end(JSON.stringify({ ok: true }));
    } catch (e: any) { res.writeHead(400, { ...cors }); res.end(JSON.stringify({ error: e.message })); }
    return true;
  }

  // Rename file/folder
  if (url?.startsWith("/api/file/rename") && method === "POST") {
    try {
      const { root, path, newPath } = await parseFileOpBody(req);
      const oldFull = resolve(root, path);
      const newFull = resolve(root, newPath || "");
      if (!oldFull.startsWith(resolve(root)) || !newFull.startsWith(resolve(root))) { res.writeHead(403, { ...cors }); res.end(JSON.stringify({ error: "Access denied" })); return true; }
      renameSync(oldFull, newFull);
      res.writeHead(200, { ...cors }); res.end(JSON.stringify({ ok: true }));
    } catch (e: any) { res.writeHead(400, { ...cors }); res.end(JSON.stringify({ error: e.message })); }
    return true;
  }

  // Delete file/folder
  if (url?.startsWith("/api/file/delete") && method === "POST") {
    try {
      const { root, path } = await parseFileOpBody(req);
      const fullPath = resolve(root, path);
      if (!fullPath.startsWith(resolve(root))) { res.writeHead(403, { ...cors }); res.end(JSON.stringify({ error: "Access denied" })); return true; }
      rmSync(fullPath, { recursive: true, force: true });
      res.writeHead(200, { ...cors }); res.end(JSON.stringify({ ok: true }));
    } catch (e: any) { res.writeHead(400, { ...cors }); res.end(JSON.stringify({ error: e.message })); }
    return true;
  }

  // Move file (drag-drop)
  if (url?.startsWith("/api/file/move") && method === "POST") {
    try {
      const { root, path, newPath } = await parseFileOpBody(req);
      const srcFull = resolve(root, path);
      const dstFull = resolve(root, newPath || "");
      if (!srcFull.startsWith(resolve(root)) || !dstFull.startsWith(resolve(root))) { res.writeHead(403, { ...cors }); res.end(JSON.stringify({ error: "Access denied" })); return true; }
      renameSync(srcFull, dstFull);
      res.writeHead(200, { ...cors }); res.end(JSON.stringify({ ok: true }));
    } catch (e: any) { res.writeHead(400, { ...cors }); res.end(JSON.stringify({ error: e.message })); }
    return true;
  }

  // Write file content
  if (url?.startsWith("/api/file/write") && method === "POST") {
    try {
      let body = "";
      req.on("data", (c: Buffer) => { body += c.toString(); });
      const result = await new Promise<any>((resolve, reject) => {
        req.on("end", () => { try { resolve(JSON.parse(body)); } catch { reject(new Error("Invalid JSON")); } });
      });
      const { root, path, content } = result;
      const fullPath = resolve(root, path);
      if (!fullPath.startsWith(resolve(root))) { res.writeHead(403, { ...cors }); res.end(JSON.stringify({ error: "Access denied" })); return true; }
      writeFileSync(fullPath, content, "utf-8");
      res.writeHead(200, { ...cors }); res.end(JSON.stringify({ ok: true }));
    } catch (e: any) { res.writeHead(400, { ...cors }); res.end(JSON.stringify({ error: e.message })); }
    return true;
  }

  return false;
};
