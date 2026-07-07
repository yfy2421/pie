/**
 * 开发模式编译 .ts → .js（递归遍历子目录）
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname, relative } from "path";
import { fileURLToPath } from "url";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "..", "src", "frontend");

function findTs(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) files.push(...findTs(full));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) files.push(full);
  }
  return files;
}

const files = findTs(SRC);
for (const fullPath of files) {
  const rel = relative(SRC, fullPath);
  const src = readFileSync(fullPath, "utf-8");
  const result = await esbuild.transform(src, { loader: "ts", minify: false });
  const outPath = resolve(SRC, rel.replace(".ts", ".js"));
  writeFileSync(outPath, result.code, "utf-8");
  console.log(`  ${rel} → ${rel.replace(".ts", ".js")}`);
}
