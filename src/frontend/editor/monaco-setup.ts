/**
 * Monaco Editor 集成 — 语言服务通过 tsserver 子进程提供
 *
 * 不再使用 Monaco 内置的 tsWorker（浏览器沙箱无法读 node_modules），
 * 改为通过 HTTP API 调用 pi-server 的 tsserver 子进程（真实 Node.js 环境）。
 *
 * 特性：
 *   - 诊断（语法/语义错误标注）— 每 2 秒轮询
 *   - 自动补全 — CompletionItemProvider
 *   - 悬停提示 — HoverProvider
 *   - 跳转定义 — DefinitionProvider
 *   - 查找引用 — ReferenceProvider
 */
import * as monaco from "monaco-editor";

// ─── 不再需要 addExtraLib — tsserver 子进程直接读文件系统 node_modules

// ─── Worker 配置 ─────────────────────────────────────────────
import editorWorkerUrl from "monaco-editor/esm/vs/editor/editor.worker?url";
import tsWorkerUrl from "monaco-editor/esm/vs/language/typescript/ts.worker?url";
import jsonWorkerUrl from "monaco-editor/esm/vs/language/json/json.worker?url";
import cssWorkerUrl from "monaco-editor/esm/vs/language/css/css.worker?url";
import htmlWorkerUrl from "monaco-editor/esm/vs/language/html/html.worker?url";

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    let url: string;
    switch (label) {
      case "typescript": case "javascript": url = tsWorkerUrl; break;
      case "json": url = jsonWorkerUrl; break;
      case "css": case "scss": case "less": url = cssWorkerUrl; break;
      case "html": case "handlebars": case "razor": url = htmlWorkerUrl; break;
      default: url = editorWorkerUrl;
    }
    return new Worker(url, { type: "module", name: label });
  },
};

// ─── 编辑器实例 ─────────────────────────────────────────────────

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let _currentFilePath = "";
let _diagTimer: ReturnType<typeof setInterval> | null = null;

// ─── tsserver 通信 ─────────────────────────────────────────────

function getRoot(): string {
  return localStorage.getItem("workspace_path") || "";
}

function absPath(filePath: string): string {
  const root = getRoot();
  return root ? root + "/" + filePath : filePath;
}

async function tsFetch(command: string, body: any): Promise<any> {
  try {
    const r = await fetch("/api/ts/" + command, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (data && data.success === false) return null; // tsserver error, silently ignore
    return data;
  } catch {
    return null;
  }
}

/** 打开文件（在 tsserver 中注册） */
export async function tsOpenFile(filePath: string, content: string): Promise<void> {
  try {
    await tsFetch("open", { file: absPath(filePath), content, scriptKindName: "TS" });
  } catch {}
}

/** 内容变更（同步到 tsserver） */
export async function tsChangeFile(filePath: string, content: string): Promise<void> {
  try {
    await tsFetch("change", { file: absPath(filePath), content });
  } catch {}
}

/** 关闭文件（释放 tsserver 资源） */
export async function tsCloseFile(filePath: string): Promise<void> {
  try {
    await tsFetch("close", { file: absPath(filePath) });
  } catch {}
}

/** 获取诊断 */
async function tsDiagnostics(filePath: string): Promise<any[]> {
  try {
    const r = await fetch(`/api/ts/diagnostics?file=${encodeURIComponent(absPath(filePath))}`);
    if (!r.ok) return [];
    const data = await r.json();
    if (data?.success === false) return [];
    return data;
  } catch { return []; }
}

// ─── 诊断轮询 ──────────────────────────────────────────────────

let _diagFile = "";

async function pollDiagnostics(): Promise<void> {
  if (!_diagFile || !editor) return;
  const model = editor.getModel();
  if (!model) return;

  try {
    const diags = await tsDiagnostics(_diagFile);
    if (diags && diags.length > 0) console.log(`[tsserver] ${diags.length} diagnostics for ${_diagFile}`);
    const markers: monaco.editor.IMarkerData[] = diags.map((d: any) => ({
      severity: d.severity === "error" || d.category === "error"
        ? monaco.MarkerSeverity.Error
        : d.category === "warning"
          ? monaco.MarkerSeverity.Warning
          : monaco.MarkerSeverity.Info,
      message: d.text || d.message || "",
      startLineNumber: d.start?.line || d.line || 1,
      startColumn: d.start?.offset || d.column || 1,
      endLineNumber: d.end?.line || d.line || 1,
      endColumn: d.end?.offset || d.column || 1,
    }));
    monaco.editor.setModelMarkers(model, "typescript", markers);
  } catch {
    // ignore
  }
}

// ─── 自定义 Language Service Providers ─────────────────────────

// 自动补全
monaco.languages.registerCompletionItemProvider("typescript", {
  triggerCharacters: [".", "\"", "'", "/", "@", "<"],
  provideCompletionItems: async (model, position) => {
    const filePath = _currentFilePath;
    if (!filePath) return { suggestions: [] };

    try {
      const result = await tsFetch("completions", {
        file: absPath(filePath),
        line: position.lineNumber,
        offset: position.column,
      });
      if (!result?.entries) return { suggestions: [] };

      const suggestions: monaco.languages.CompletionItem[] = result.entries.map((e: any) => ({
        label: e.name,
        kind: mapCompletionKind(e.kind),
        detail: e.kind,
        sortText: e.sortText,
        insertText: e.name,
        range: { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column },
      }));
      return { suggestions };
    } catch {
      return { suggestions: [] };
    }
  },
});

// 悬停提示
monaco.languages.registerHoverProvider("typescript", {
  provideHover: async (model, position) => {
    const filePath = _currentFilePath;
    if (!filePath) return null;

    try {
      const result = await tsFetch("quickinfo", {
        file: absPath(filePath),
        line: position.lineNumber,
        offset: position.column,
      });
      if (!result) return null;

      const contents: monaco.IMarkdownString[] = [];
      if (result.displayString) {
        contents.push({ value: "```typescript\n" + result.displayString + "\n```" });
      }
      if (result.documentation) {
        contents.push({ value: result.documentation });
      }

      return {
        contents,
        range: result.start
          ? new monaco.Range(
              result.start.line, result.start.offset,
              (result.end || result.start).line, (result.end || result.start).offset
            )
          : undefined,
      };
    } catch {
      return null;
    }
  },
});

// 跳转定义
monaco.languages.registerDefinitionProvider("typescript", {
  provideDefinition: async (model, position) => {
    const filePath = _currentFilePath;
    if (!filePath) return [];

    try {
      const result = await tsFetch("definition", {
        file: absPath(filePath),
        line: position.lineNumber,
        offset: position.column,
      });
      if (!result?.definitions) return [];

      return result.definitions.map((d: any) => ({
        uri: monaco.Uri.parse("file:///" + encodeURIComponent(d.file.replace(/\\/g, "/"))),
        range: new monaco.Range(d.start?.line || 1, d.start?.offset || 1, d.end?.line || 1, d.end?.offset || 1),
      }));
    } catch {
      return [];
    }
  },
});

// 查找引用
monaco.languages.registerReferenceProvider("typescript", {
  provideReferences: async (model, position) => {
    const filePath = _currentFilePath;
    if (!filePath) return [];

    try {
      const result = await tsFetch("references", {
        file: absPath(filePath),
        line: position.lineNumber,
        offset: position.column,
      });
      if (!result?.refs) return [];

      return result.refs.map((r: any) => ({
        uri: monaco.Uri.parse("file:///" + encodeURIComponent(r.file.replace(/\\/g, "/"))),
        range: new monaco.Range(r.start?.line || 1, r.start?.offset || 1, r.end?.line || 1, r.end?.offset || 1),
      }));
    } catch {
      return [];
    }
  },
});

// ─── Completion kind mapping ───────────────────────────────────

const completionKindMap: Record<number, monaco.languages.CompletionItemKind> = {
  0: monaco.languages.CompletionItemKind.Text,
  1: monaco.languages.CompletionItemKind.Method,
  2: monaco.languages.CompletionItemKind.Function,
  3: monaco.languages.CompletionItemKind.Constructor,
  4: monaco.languages.CompletionItemKind.Field,
  5: monaco.languages.CompletionItemKind.Variable,
  6: monaco.languages.CompletionItemKind.Class,
  7: monaco.languages.CompletionItemKind.Struct,
  8: monaco.languages.CompletionItemKind.Interface,
  9: monaco.languages.CompletionItemKind.Module,
  10: monaco.languages.CompletionItemKind.Property,
  11: monaco.languages.CompletionItemKind.Event,
  12: monaco.languages.CompletionItemKind.Operator,
  13: monaco.languages.CompletionItemKind.Unit,
  14: monaco.languages.CompletionItemKind.Value,
  15: monaco.languages.CompletionItemKind.Constant,
  16: monaco.languages.CompletionItemKind.Enum,
  17: monaco.languages.CompletionItemKind.EnumMember,
  18: monaco.languages.CompletionItemKind.Keyword,
  19: monaco.languages.CompletionItemKind.Snippet,
  20: monaco.languages.CompletionItemKind.Color,
  21: monaco.languages.CompletionItemKind.File,
  22: monaco.languages.CompletionItemKind.Reference,
  23: monaco.languages.CompletionItemKind.Deprecated,
};

function mapCompletionKind(kind: string | number): monaco.languages.CompletionItemKind {
  if (typeof kind === "number") return completionKindMap[kind] || monaco.languages.CompletionItemKind.Text;
  const strMap: Record<string, monaco.languages.CompletionItemKind> = {
    method: monaco.languages.CompletionItemKind.Method,
    function: monaco.languages.CompletionItemKind.Function,
    constructor: monaco.languages.CompletionItemKind.Constructor,
    field: monaco.languages.CompletionItemKind.Field,
    variable: monaco.languages.CompletionItemKind.Variable,
    class: monaco.languages.CompletionItemKind.Class,
    interface: monaco.languages.CompletionItemKind.Interface,
    module: monaco.languages.CompletionItemKind.Module,
    property: monaco.languages.CompletionItemKind.Property,
    constant: monaco.languages.CompletionItemKind.Constant,
    enum: monaco.languages.CompletionItemKind.Enum,
    keyword: monaco.languages.CompletionItemKind.Keyword,
  };
  return strMap[kind.toLowerCase()] || monaco.languages.CompletionItemKind.Text;
}

// ─── 语言映射 ───────────────────────────────────────────────────

const langMap: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  json: "json", md: "markdown",
  html: "html", htm: "html", css: "css", scss: "scss", less: "less",
  py: "python", rs: "rust", go: "go", rb: "ruby", php: "php",
  java: "java", kt: "kotlin", swift: "swift",
  c: "c", cpp: "cpp", h: "c", cs: "csharp",
  sh: "shell", bash: "shell", yml: "yaml", yaml: "yaml",
  xml: "xml", svg: "xml", vue: "html", svelte: "html",
  sql: "sql", r: "r", pl: "perl", lua: "lua", scala: "scala",
  hs: "haskell", dart: "dart", zig: "zig", graphql: "graphql",
  toml: "ini", env: "dotenv", conf: "ini", cfg: "ini",
};

function langFromPath(id: string): string {
  const ext = (id.split(".").pop() || "").toLowerCase();
  return langMap[ext] || "plaintext";
}

// ─── 自定义主题与背景色统一 ──────────────────────────────────

// 暗色主题 — 与应用 --bg: #0A0A0F 保持一致
monaco.editor.defineTheme("app-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#0A0A0F",
    "editor.foreground": "#F1F1F9",
    "editor.lineHighlightBackground": "#111118",
    "editor.selectionBackground": "#222238",
    "editor.inactiveSelectionBackground": "#1E1E30",
    "editorCursor.foreground": "#F59E0B",
    "editorLineNumber.foreground": "#555570",
    "editorLineNumber.activeForeground": "#A0A0BB",
    "editor.selectionHighlightBackground": "#262640",
    "editorBracketMatch.background": "#1E1E30",
    "editorBracketMatch.border": "#333358",
    "editorWidget.background": "#111118",
    "editorWidget.border": "#262640",
    "editorSuggestWidget.background": "#111118",
    "editorSuggestWidget.border": "#262640",
    "editorSuggestWidget.selectedBackground": "#222238",
    "minimap.background": "#0A0A0F",
  },
});

// 亮色主题 — 简约亮色
monaco.editor.defineTheme("app-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#FAFAFA",
    "editor.foreground": "#333333",
    "editor.lineHighlightBackground": "#F0F0F0",
    "editor.selectionBackground": "#D6E8FF",
    "editorCursor.foreground": "#F59E0B",
    "editorLineNumber.foreground": "#CCCCCC",
    "editorLineNumber.activeForeground": "#888888",
    "editorWidget.background": "#FAFAFA",
    "editorWidget.border": "#E0E0E0",
    "minimap.background": "#FAFAFA",
  },
});

// ─── 编辑器创建 ─────────────────────────────────────────────────

export function monacoCreateEditor(container: HTMLElement): void {
  if (editor) {
    editor.dispose();
    if (_diagTimer) { clearInterval(_diagTimer); _diagTimer = null; }
  }
  _currentFilePath = "";

  // 禁用 Monaco 内置 TS 诊断，仅用 tsserver（避免两个来源抢 marker 控制权）
  // 内置 Worker 不读 node_modules，报的"cannot find module"是误报
  // tsserver 能读文件系统，诊断更准确
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
  });
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
  });

  // 创建初始模型
  const initUri = monaco.Uri.parse("file:///untitled.ts");
  const initModel = monaco.editor.createModel("", "plaintext", initUri);

  // 从 localStorage 加载用户设置
  const editorFontSize = parseInt(localStorage.getItem('editor-font-size') || '13', 10);
  const editorTabSize = parseInt(localStorage.getItem('editor-tab-size') || '2', 10);
  const editorUseTabs = localStorage.getItem('editor-use-tabs') === '1';
  const editorTheme = localStorage.getItem('editor-theme') || 'vs-dark';

  const isLight = editorTheme === 'vs';
  document.documentElement.classList.toggle('theme-light', isLight);
  editor = monaco.editor.create(container, {
    model: initModel,
    theme: isLight ? 'app-light' : 'app-dark',
    minimap: { enabled: true },
    automaticLayout: true,
    fontSize: editorFontSize,
    fontFamily: "DM Mono, monospace",
    scrollBeyondLastLine: false,
    lineNumbers: "on",
    renderWhitespace: "selection",
    tabSize: editorTabSize,
    indentSize: editorTabSize,
    useTabStops: editorUseTabs,
    wordWrap: "off",
    smoothScrolling: true,
    cursorBlinking: "smooth",
    padding: { top: 12, bottom: 12 },
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    parameterHints: { enabled: true },
    bracketPairColorization: { enabled: true },
  });

  // Ctrl+Space 触发补全
  editor.addAction({
    id: "trigger-suggest",
    label: "Trigger Suggest",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space],
    run: (ed) => ed.getAction("editor.action.triggerSuggest")?.run(),
  });

  // 内容变更时同步到 tsserver（初始内容已通过 tsOpenFile 发送，此处只响应用户输入）
  editor.onDidChangeModelContent(() => {
    if (!editor?.hasTextFocus()) return; // 跳过程序化 setValue，只响应用户输入
    if (!_currentFilePath) return;
    const model = editor?.getModel();
    if (!model) return;
    const lang = model.getLanguageId();
    if (lang !== "typescript" && lang !== "javascript") return;
    tsChangeFile(_currentFilePath, model.getValue());
  });

  // 启动诊断轮询（每 3 秒轮询当前文件）
  _diagTimer = setInterval(pollDiagnostics, 3000);
}

export function monacoSetValue(val: string): void {
  if (editor) editor.setValue(val);
}

export function monacoGetValue(): string {
  return editor?.getValue() ?? "";
}

export function monacoSetLanguage(id: string): void {
  if (!editor) return;
  if (id === _currentFilePath) return;

  const lang = langFromPath(id);
  const model = editor.getModel();
  if (!model) return;

  _currentFilePath = id;
  _diagFile = id;
  monaco.editor.setModelLanguage(model, lang);

  // 通知 tsserver 打开文件（仅 TS/JS 文件）
  if (lang === "typescript" || lang === "javascript") {
    const content = model.getValue();
    tsOpenFile(id, content);
  }
}

/** 从设置页更新编辑器配置 */
export function updateEditorSettings(): void {
  if (!editor) return;
  const fontSize = parseInt(localStorage.getItem('editor-font-size') || '13', 10);
  const tabSize = parseInt(localStorage.getItem('editor-tab-size') || '2', 10);
  const useTabs = localStorage.getItem('editor-use-tabs') === '1';
  const theme = localStorage.getItem('editor-theme') || 'vs-dark';
  editor.updateOptions({ fontSize, tabSize, indentSize: tabSize, useTabStops: useTabs });
  const isLight = theme === 'vs';
  document.documentElement.classList.toggle('theme-light', isLight);
  monaco.editor.setTheme(isLight ? 'app-light' : 'app-dark');
}

/** 释放 Monaco 焦点（防止它阻塞 UI 事件） */
export function monacoBlur(): void {
  editor?.blur();
}

/** 暂停 diagnostics 轮询 */
export function monacoPauseDiags(): void {
  if (_diagTimer) { clearInterval(_diagTimer); _diagTimer = null; }
  _diagFile = "";
}

/** 恢复 diagnostics 轮询 */
export function monacoResumeDiags(): void {
  if (!_diagTimer && editor) {
    _diagTimer = setInterval(pollDiagnostics, 3000);
  }
}

export function monacoDispose(): void {
  if (_diagTimer) { clearInterval(_diagTimer); _diagTimer = null; }
  editor?.dispose();
  editor = null;
}

// 暴露到全局
(window as any).__monaco = {
  create: monacoCreateEditor,
  setValue: monacoSetValue,
  getValue: monacoGetValue,
  setLang: monacoSetLanguage,
  dispose: monacoDispose,
  tsOpenFile,
  tsChangeFile,
  tsCloseFile,
  updateSettings: updateEditorSettings,
  blur: monacoBlur,
  pauseDiags: monacoPauseDiags,
};
