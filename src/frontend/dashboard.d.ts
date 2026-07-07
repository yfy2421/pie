// 共享类型声明 — 被所有 dashboard-*.ts 引用

interface DashboardData {
  modelProvider: string;
  modelId: string;
  modelContextWindow: number | string;
  modelMaxTokens: number | string;
  thinkingLevel: string;
  runtime: number;
  messagesCount: number;
  isIdle: boolean;
  tools: string[];
  activeTools: string[];
  dataDir: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

interface ProviderKeyInfo {
  hasKey: boolean;
  keyPreview: string;
  keyFull: string;
}

interface ElectronAPI {
  minimize(): void;
  maximize(): void;
  close(): void;
  newWindow(): void;
  openFile(): Promise<string | null>;
  openFolder(): Promise<string | null>;
  showItemInFolder(path: string): void;
  trashItem(path: string): Promise<void>;
  spawnTerminal(): void;
}

interface AppState {
  D: DashboardData | null;
  M: Message[];
  IL: boolean;
  CS: EventSource | null;
  CT: string;
  _activePanel: string;
  _fileTabs: FileTab[];
  _activeFileTab: string | null;
}

interface FileTab {
  id: string;      // file path
  label: string;   // file name
  content: string;
  lang: string;
}

// ─── App 命名空间 ─────────────────────────────────────────────
// 收敛所有全局函数，逐步替代 window.xxx 模式
interface AppNamespace {
  UI: Record<string, Function>;
  Chat: Record<string, Function>;
  File: Record<string, Function>;
  Session: Record<string, Function>;
  Settings: Record<string, Function>;
}

interface Window {
  electronAPI?: ElectronAPI;
  _provOrder?: string[];
  __state: AppState;
  App: AppNamespace;
}

// 公共函数声明（在 HTML onclick 中用）
declare function $(id: string): HTMLElement | null;
declare function S(name: string, size?: number): string;
declare function E(s: unknown): string;
declare function F(s: number): string;
declare function sb(id: string): void;
declare function toast(msg: string, type?: 'info' | 'error' | 'success'): void;
declare function getD(): Promise<void>;
declare function refresh(): Promise<void>;
declare function winCtrl(action: string): void;
declare function layout(): void;
declare function togglePanel(name: string): void;
declare function renderPanel(name: string, pc?: HTMLElement | null): void;
declare function sinfoHTML(): string;
declare function refreshSinfo(): void;
declare function msgs(): string;
declare function appendDelta(text: string): void;
declare function bind(): void;
declare function updateUI(): void;
declare function showModelPicker(e: MouseEvent): void;
declare function toggleFileMenu(ev: MouseEvent): void;
declare function closeFM(): void;
declare function fileAction(action: string): void;
declare function launchCli(): void;
declare function openSettingsModal(): void;
declare function closeSettingsModal(): void;
declare function switchSettingsModal(tab: string): void;
declare function selectProvider(prov: string): void;
declare function toggleKeyVis(prov: string): void;
declare function saveApiKey(provider: string): void;
declare function loadProviderModels(prov: string): void;
declare function selectModel(provider: string, modelId: string): void;
declare function provDragStart(ev: DragEvent, idx: number): void;
declare function provDragOver(ev: DragEvent, idx: number): void;
declare function provDrop(ev: DragEvent, idx: number): void;
declare function loadSessions(): void;
declare function newSession(): void;
declare function renameSession(el: HTMLElement, id: string): void;
declare function deleteSession(id: string): void;
declare function switchSession(id: string): void;

// Tree widget
interface TreeNode { id: string; label: string; icon: string; isDir: boolean; children?: TreeNode[]; }
declare class Tree {
  constructor(container: HTMLElement, opts?: { indent?: number });
  setData(data: TreeNode[]): void;
  setChildren(parentId: string, children: TreeNode[]): void;
  onSelect: ((node: TreeNode) => void) | null;
  onExpand: ((node: TreeNode, cb: (children?: TreeNode[]) => void) => void) | null;
  contextMenu: { label: string; action: (node: TreeNode, tree: Tree) => void; disabled?: (node: TreeNode) => boolean }[];
  blankContextMenu: { label: string; action: () => void }[];
  inlineRename(id: string, cb: (newName: string) => void, onCancel?: () => void): void;
  inlineCreate(parentId: string, isDir: boolean, onCreate: (name: string) => void): void;
  onDragMove: ((srcId: string, dstId: string) => void) | null;
  clearChildCache(): void;
}

// Pane registration
declare function registerPane(name: string, render: (container: HTMLElement) => void): void;

// File tabs (VS Code style)
declare function openFileTab(id: string, content: string, lang?: string): void;
declare function closeFileTab(id: string): void;
declare function switchTab(fileId: string | null): void;
declare function renderTabs(): void;

// ─── Chat Attachment Types ──────────────────────────────────────
type AttachmentKind = "file" | "folder" | "clip";

interface ChatAttachment {
  id: string;
  kind: AttachmentKind;
  path: string;      // relative to workspace root
  name: string;      // display name
  // clip only
  startLine?: number;
  endLine?: number;
  // folder only
  fileCount?: number;
  totalBytes?: number;
  truncated?: boolean;
}

// ExplorerService
declare class ExplorerService {
  static fetchDir(root: string, path: string): Promise<{ items: any[]; rootDir: string; relativePath: string }>;
  static getWorkspacePath(): string;
  static setWorkspacePath(p: string): void;
  static selectWorkspace(): Promise<string | null>;
  static applyWorkspace(): Promise<void>;
  static iconFor(name: string, dir: boolean): string;
  static toTreeNodes(items: any[]): TreeNode[];
  static fileOp(op: 'new' | 'rename' | 'delete' | 'move', root: string, path: string, newPath?: string): Promise<void>;
  static _setTree(t: Tree | null): void;
  static _getTree(): Tree | null;
  static refreshTree(): Promise<void>;
}
