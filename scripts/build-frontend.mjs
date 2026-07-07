/**
 * 前端构建脚本
 * 1. 运行 Vite（处理 HTML + CSS，产出 dist/frontend/）
 * 2. 合并 6 个 JS 文件为 dashboard.js
 * 3. 用 esbuild 压缩
 * 4. 更新 HTML 中 script 标签
 */
import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { resolve, dirname, relative } from "path";
import { fileURLToPath } from "url";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "src", "frontend");
const OUT = resolve(ROOT, "dist", "frontend");

// 1. Vite build
console.log("→ Vite build…");
execSync("npx vite build", { cwd: ROOT, stdio: "inherit" });

// 2. 合并 JS（递归收集）
console.log("→ 合并 JS…");
function findTs(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const e of entries) {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) files = files.concat(findTs(full));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) files.push(full);
  }
  return files;
}
const tsFiles = findTs(SRC).sort();

const bundle = tsFiles
  .map((f) => readFileSync(f, "utf-8"))
  .join("\n");

// 3. 用 esbuild 压缩
const result = await esbuild.transform(bundle, {
  loader: "ts",
  minify: true,
  legalComments: "none",
});
const minified = result.code;
console.log(`  压缩: ${(bundle.length / 1024).toFixed(0)} KB → ${(minified.length / 1024).toFixed(0)} KB`);

mkdirSync(resolve(OUT, "js"), { recursive: true });
writeFileSync(resolve(OUT, "js", "dashboard.js"), minified, "utf-8");

// 4. 更新 HTML — 替换多个 script 标签为一个
console.log("→ 更新 HTML…");
const htmlPath = resolve(OUT, "dashboard.html");
let html = readFileSync(htmlPath, "utf-8");

// 替换 6 个 <script src="./dashboard-*.js"> 为一个
html = html.replace(
  /<script src="\.\/dashboard-[^"]+"><\/script>\n(<script src="\.\/dashboard-[^"]+"><\/script>\n)*/,
  '<script src="./js/dashboard.js"></script>\n'
);

writeFileSync(htmlPath, html, "utf-8");
console.log("✓ 构建完成");
