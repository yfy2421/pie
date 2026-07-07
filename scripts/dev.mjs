/**
 * My Code Agent — 开发启动脚本
 *
 * 新架构（三者独立进程，可各自重启）:
 * 1. Vite dev server (port 5173) — 前端 HMR
 * 2. pi-server (port 3099) — API 后端
 * 3. Electron — 加载 Vite 页面
 *
 * 前端文件变化 → Vite HMR 即时更新，无需重启
 * server.ts 变化 → 仅重启 pi-server 进程
 * electron-main.ts 变化 → 仅重启 Electron
 */
import { spawn, execSync } from "child_process";
import { createServer } from "net";
import { watch } from "chokidar";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ELECTRON_SRC = path.resolve(ROOT, "src");
const PID_FILE = path.resolve(ROOT, "data", "pi", ".dev.pid");

const DEV_PORT = 3099;
const VITE_PORT = 5173;

// ─── 端口检测 & 释放 ─────────────────────────────────────────
function isPortInUse(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(true));
    srv.once("listening", () => { srv.close(); resolve(false); });
    srv.listen(port, "127.0.0.1");
  });
}

// ─── 清理残留进程 ─────────────────────────────────────────────
function cleanupOldProcesses() {
  // 强制杀掉上次的 Electron / Vite / pi-server
  try { execSync(`taskkill /F /IM electron.exe`, { stdio: "ignore" }); } catch {}
  // 用端口反查 PID 杀掉残留
  for (const p of [DEV_PORT, VITE_PORT]) {
    try {
      const out = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${p} "`, { encoding: "utf8", stdio: "pipe" });
      for (const line of out.trim().split("\n")) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && pid !== "0") { try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" }); } catch {} }
      }
    } catch {}
  }
  try { fs.unlinkSync(PID_FILE); } catch {}
}

function registerPid(pid) {
  try {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(pid));
  } catch { /* ignore */ }
}

function removePid() {
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}

// ─── 编译 Electron ────────────────────────────────────────────
function buildElectron() {
  console.log("🔨 Compiling electron main...");
  try {
    execSync("npx tsc -p tsconfig.electron.json", { cwd: ROOT, stdio: "pipe" });
    const preloadPath = path.join(ROOT, "dist-electron", "electron", "preload.js");
    fs.writeFileSync(preloadPath, `const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  openFile: () => ipcRenderer.invoke('dialog-open-file'),
  openFolder: () => ipcRenderer.invoke('open-folder-dialog'),
  showItemInFolder: (path) => ipcRenderer.invoke('show-item-in-folder', path),
  trashItem: (path) => ipcRenderer.invoke('trash-item', path),
  newWindow: () => ipcRenderer.send('window-new'),
  spawnTerminal: () => ipcRenderer.invoke('spawn-terminal'),
});
`);
    console.log("✅ Electron compiled");
  } catch (err) {
    console.error("❌ Compile failed:", err.stderr?.toString() || err.message);
  }
}

// ─── 进程管理 ─────────────────────────────────────────────────
let serverProcess = null;
let electronProcess = null;
let viteProcess = null;

async function startVite() {
  if (viteProcess) return;
  console.log("📦 Starting Vite dev server...");
  viteProcess = spawn("npx", ["vite", "--host", "127.0.0.1"], {
    cwd: ROOT, stdio: "inherit", shell: true,
  });
  viteProcess.on("exit", (code) => {
    viteProcess = null;
    if (code !== 0) console.log(`Vite exited with code ${code}`);
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    if (serverProcess) {
      stopServer();
      setTimeout(() => resolve(startServer()), 500);
      return;
    }
    console.log("⚙️  Starting pi-server...");
    const started = Date.now();
    serverProcess = spawn("npx", ["tsx", "src/server/server.ts"], {
      cwd: ROOT, stdio: ["pipe", "pipe", "inherit"], shell: true,
      env: { ...process.env, PI_DEV_PORT: String(DEV_PORT) },
    });
    let resolved = false;
    serverProcess.stdout?.on("data", (chunk) => {
      process.stdout.write(chunk); // 转发输出到控制台
      if (!resolved && chunk.toString().includes("SERVER_PORT:")) {
        resolved = true;
        const elapsed = Date.now() - started;
        console.log(`⏱️  pi-server ready in ${elapsed}ms`);
        resolve();
      }
    });
    serverProcess.on("exit", (code) => {
      serverProcess = null;
      if (code !== 0 && !resolved) {
        console.log(`pi-server exited with code ${code} — restarting in 1s...`);
        setTimeout(() => resolve(startServer()), 1000);
      }
    });
    serverProcess.on("error", reject);
    // 30 秒超时
    setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, 30000);
  });
}

function stopServer() {
  if (serverProcess) {
    try { execSync(`taskkill /F /T /PID ${serverProcess.pid}`, { stdio: "ignore" }); } catch {}
    serverProcess = null;
  }
}

function startElectron() {
  if (electronProcess) {
    // 先关闭所有旧 Electron 窗口
    try { execSync("taskkill /F /IM electron.exe", { stdio: "ignore" }); } catch {}
    electronProcess = null;
  }
  console.log("⚡ Starting Electron...");
  // 如需 HMR（从 Vite 加载），将下面 env 中的 VITE_DEV_PORT 取消注释
  // ELECTRON_RUN_AS_NODE 强制 Electron 以 Node.js 模式运行，跳过主进程初始化
  const electronEnv = { ...process.env };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  electronProcess = spawn("npx", ["electron", "."], {
    cwd: ROOT, stdio: "inherit", shell: true,
    env: { ...electronEnv, NODE_ENV: "development", VITE_DEV_PORT: String(VITE_PORT) },
  });
  registerPid(electronProcess.pid);
  electronProcess.on("exit", (code) => {
    electronProcess = null;
    if (code !== 0 && code !== null) {
      setTimeout(startElectron, 1000);
    }
  });
}

// ─── 文件监听 ─────────────────────────────────────────────────
function setupWatcher() {
  const serverWatcher = watch([
    path.join(ELECTRON_SRC, "server", "server.ts"),
    path.join(ELECTRON_SRC, "frontend", "dashboard.html"),
  ], { ignoreInitial: true });

  serverWatcher.on("change", async (f) => {
    console.log(`📝 ${path.relative(ROOT, f)} changed — restarting pi-server`);
    await startServer();
  });

  const electronWatcher = watch([
    path.join(ELECTRON_SRC, "electron", "electron-main.ts"),
    path.join(ELECTRON_SRC, "electron", "preload.ts"),
  ], { ignoreInitial: true });

  electronWatcher.on("change", (f) => {
    console.log(`📝 ${path.relative(ROOT, f)} changed — rebuilding & restarting Electron`);
    buildElectron();
    setTimeout(startElectron, 300);
  });
}

// ─── 入口 ─────────────────────────────────────────────────────
async function main() {
  cleanupOldProcesses();

  // 1. 编译 Electron
  buildElectron();

  // 2. 编译 TS→JS（Vite dev server 需要 .js 文件）
  console.log("🔁 Compiling frontend TS→JS...");
  try {
    execSync("node scripts/compile-frontend-ts.mjs", { cwd: ROOT, stdio: "pipe" });
  } catch { console.log("⚠️  Frontend TS compile had issues"); }

  // 3. 等待端口可用
  if (await isPortInUse(DEV_PORT)) {
    console.log(`⚠️  Port ${DEV_PORT} in use, waiting 2s...`);
    await new Promise(r => setTimeout(r, 2000));
  }

  // 3. 启动 Vite dev server
  await startVite();

  // 5. 启动 pi-server（等待实际就绪）
  await startServer();

  // 6. 启动 Electron
  startElectron();

  // 7. 文件监听
  setupWatcher();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

function cleanup() {
  try { execSync(`taskkill /F /T /PID ${electronProcess?.pid}`, { stdio: "ignore" }); } catch {}
  try { execSync(`taskkill /F /T /PID ${serverProcess?.pid}`, { stdio: "ignore" }); } catch {}
  try { execSync(`taskkill /F /T /PID ${viteProcess?.pid}`, { stdio: "ignore" }); } catch {}
  electronProcess = null;
  serverProcess = null;
  viteProcess = null;
  removePid();
}
