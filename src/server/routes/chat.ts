/**
 * Chat routes — POST /api/chat, GET /api/chat/stream (SSE)
 */
import type { RouteHandler } from "./types";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, readdirSync } from "fs";
import { resolve, basename, relative } from "path";

// ─── Attachment processing ──────────────────────────────────

const ATTACH_FILE_MAX_BYTES = 64 * 1024;   // 64KB per file
const ATTACH_TOTAL_MAX_BYTES = 256 * 1024; // 256KB total
const ATTACH_FOLDER_MAX_FILES = 50;        // max files per folder
const ATTACH_EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'data', '.claude']);

const BINARY_EXT = new Set([
  'png','jpg','jpeg','gif','ico','webp','bmp','svg',
  'woff','woff2','ttf','eot','otf',
  'zip','rar','7z','gz','tar','exe','dll','so','dylib',
  'pdf','doc','docx','xls','xlsx','ppt','pptx',
  'mp3','mp4','avi','mov','wav','flac','ogg',
  'pyc','class','o','a','lib',
]);

function isBinaryFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return BINARY_EXT.has(ext);
}

function isTextFile(filePath: string): boolean {
  if (isBinaryFile(filePath)) return false;
  // Try reading a small chunk — if null bytes → binary
  try {
    const fd = readFileSync(filePath);
    // Check for null bytes in first 8KB
    const buf = fd.slice(0, 8192);
    return !buf.includes(0);
  } catch { return false; }
}

/** Walk a directory, returning text file paths (relative) */
function walkFolder(dir: string, baseDir: string, maxFiles: number): string[] {
  const results: string[] = [];
  function walk(current: string) {
    if (results.length >= maxFiles) return;
    let entries: string[];
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= maxFiles) return;
      if (ATTACH_EXCLUDE_DIRS.has(e.name)) continue;
      if (e.name.startsWith('.')) continue;
      const full = resolve(current, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        const rel = relative(baseDir, full).replace(/\\/g, '/');
        if (isTextFile(full)) results.push(rel);
      }
    }
  }
  walk(baseDir);
  return results.slice(0, maxFiles);
}

interface ProcessedAttach {
  path: string;
  content: string;
  truncated: boolean;
  kind: string;
  startLine?: number;
  endLine?: number;
}

function processAttachments(atts: any[], workspace: string): { blocks: ProcessedAttach[]; totalBytes: number } {
  const blocks: ProcessedAttach[] = [];
  let totalBytes = 0;
  const ws = resolve(workspace || '');

  for (const att of atts) {
    const kind: string = att.kind || 'file';
    const attPath: string = att.path || '';
    if (!attPath) continue;

    const fullPath = resolve(ws, attPath);
    // Security: ensure path is within workspace
    if (!fullPath.startsWith(ws)) continue;

    if (kind === 'folder') {
      // Walk folder
      const files = walkFolder(fullPath, ws, ATTACH_FOLDER_MAX_FILES);
      let folderBytes = 0;
      for (const relPath of files) {
        if (totalBytes >= ATTACH_TOTAL_MAX_BYTES) break;
        const fp = resolve(ws, relPath);
        try {
          let content = readFileSync(fp, 'utf-8');
          let truncated = false;
          if (content.length > ATTACH_FILE_MAX_BYTES) {
            content = content.slice(0, ATTACH_FILE_MAX_BYTES) + '\n\n// [truncated: 文件超过64KB]';
            truncated = true;
          }
          const bytes = content.length;
          if (totalBytes + bytes > ATTACH_TOTAL_MAX_BYTES) {
            // Truncate to fit remaining budget
            const remaining = ATTACH_TOTAL_MAX_BYTES - totalBytes;
            content = content.slice(0, Math.max(remaining, 100)) + '\n\n// [truncated: 上下文限制]';
            totalBytes = ATTACH_TOTAL_MAX_BYTES;
            blocks.push({ path: relPath, content, truncated: true, kind: 'file' });
            break;
          }
          totalBytes += bytes;
          folderBytes += bytes;
          blocks.push({ path: relPath, content, truncated, kind: 'file' });
        } catch { /* skip unreadable */ }
      }
      if (files.length > ATTACH_FOLDER_MAX_FILES) {
        blocks.push({
          path: attPath,
          content: '',
          truncated: true,
          kind: 'folder',
        });
      }
    } else if (kind === 'clip') {
      // Read file and extract lines
      try {
        const content = readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const startLine = Math.max(1, att.startLine || 1);
        const endLine = Math.min(lines.length, att.endLine || startLine);
        const clipContent = lines.slice(startLine - 1, endLine).join('\n');
        blocks.push({
          path: attPath,
          content: clipContent || '(empty)',
          truncated: clipContent.length > ATTACH_FILE_MAX_BYTES,
          kind: 'clip',
          startLine,
          endLine,
        });
        totalBytes += clipContent.length;
      } catch { /* skip unreadable */ }
    } else {
      // File
      try {
        let content = readFileSync(fullPath, 'utf-8');
        let truncated = false;
        if (content.length > ATTACH_FILE_MAX_BYTES) {
          content = content.slice(0, ATTACH_FILE_MAX_BYTES) + '\n\n// [truncated: 文件超过64KB]';
          truncated = true;
        }
        if (totalBytes + content.length > ATTACH_TOTAL_MAX_BYTES) {
          const remaining = ATTACH_TOTAL_MAX_BYTES - totalBytes;
          content = content.slice(0, Math.max(remaining, 100)) + '\n\n// [truncated: 上下文限制]';
          truncated = true;
        }
        totalBytes += content.length;
        blocks.push({ path: attPath, content, truncated, kind: 'file' });
      } catch { /* skip unreadable */ }
    }
  }
  return { blocks, totalBytes };
}

function buildContextBlock(blocks: ProcessedAttach[]): string {
  if (blocks.length === 0) return '';
  const parts: string[] = ['\n\n引用上下文：'];
  for (const b of blocks) {
    if (b.kind === 'folder' && b.content === '') {
      parts.push(`  folder: ${b.path} (包含超过${ATTACH_FOLDER_MAX_FILES}个文件，已截断)`);
      continue;
    }
    if (b.kind === 'clip') {
      parts.push(`\`\`\`${b.path} (${b.startLine}-${b.endLine})`);
    } else {
      parts.push(`\`\`\`${b.path}`);
    }
    parts.push(b.content);
    if (b.truncated) parts.push('// [truncated]');
    parts.push('```');
  }
  return parts.join('\n');
}

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
        const { message, workspace, attachments } = parsed;
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
        // 处理引用文件附件
        let finalMessage = message;
        if (attachments && Array.isArray(attachments) && attachments.length > 0) {
          const ws = workspace || p.APP_ROOT;
          console.log(`📎 Processing ${attachments.length} attachment(s)`);
          const { blocks } = processAttachments(attachments, ws);
          const contextBlock = buildContextBlock(blocks);
          if (contextBlock) {
            finalMessage = message + contextBlock;
            console.log(`📎 Added ${blocks.length} file(s) to context`);
          }
        }
        // 立即返回，不 await prompt()，SSE 流式推送 + agent_end 处理 workspace 标记
        session.prompt(finalMessage).catch(() => {});
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
