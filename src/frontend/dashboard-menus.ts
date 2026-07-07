// ═══════════════════════════════════════════════════════════════════
//  文件菜单 (顶部栏下拉)
// ═══════════════════════════════════════════════════════════════════

function toggleFileMenu(ev: MouseEvent): void {
  const existing = $('file-menu');
  if (existing) { existing.remove(); return; }
  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = 'file-menu';
  menu.style.cssText = `position:fixed;top:${rect.bottom+2}px;left:${rect.left}px;z-index:900;background:var(--bs);border:1px solid var(--bd);border-radius:8px;padding:4px;min-width:160px;box-shadow:0 8px 32px rgba(0,0,0,.4)`;
  menu.innerHTML = `
    <div class="fm-item" onclick="fileAction('newWindow');closeFM()">新建窗口</div>
    <div class="fm-item" onclick="fileAction('openFile');closeFM()">打开文件</div>
    <div class="fm-item" onclick="fileAction('openFolder');closeFM()">打开文件夹</div>
    <div class="fm-sep"></div>
    <div class="fm-item" onclick="fileAction('save');closeFM()">保存 <span style="color:var(--tm);font-size:10px;float:right">Ctrl+S</span></div>
    <div class="fm-item" onclick="fileAction('saveAll');closeFM()">全部保存</div>
    <div class="fm-item" onclick="fileAction('toggleAutoSave');closeFM()">${localStorage.getItem('auto-save') === '1' ? '✓ ' : ''}自动保存</div>
    <div class="fm-sep"></div>
    <div class="fm-item" onclick="fileAction('closeWindow');closeFM()">关闭窗口</div>
  `;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', closeFMOutside as any, true), 0);
}

function closeFM(): void {
  const el = $('file-menu');
  if (el) el.remove();
  document.removeEventListener('click', closeFMOutside as any, true);
}

function closeFMOutside(ev: MouseEvent): void {
  if (!(ev.target as HTMLElement).closest('#file-menu') && !(ev.target as HTMLElement).closest('.top-tab')) closeFM();
}

function fileAction(action: string): void {
  const api = (window as any).electronAPI as ElectronAPI | undefined;
  if (action === 'newWindow' && api) api.newWindow();
  else if (action === 'openFile' && api) api.openFile().then((p: string | null) => { if (p) toast('已选择: ' + p); });
  else if (action === 'openFolder' && api) api.openFolder().then((p: string | null) => {
    if (p) {
      const oldPath = localStorage.getItem('workspace_path');
      if (p === oldPath) return; // 同路径不重复切换
      localStorage.setItem('workspace_path', p);
      fetch('/api/workspace/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: p }) }).catch(() => {});
      toast('工作区: ' + p);
      // 清理旧工作区的文件标签和会话
      window.__state._fileTabs = [];
      window.__state._activeFileTab = null;
      window.__state.M = [];
      try { localStorage.removeItem('file-tabs'); } catch {}
      const m = (window as any).__monaco;
      if (m?.dispose) m.dispose();
      switchTab(null);
      // 重新渲染 Explorer
      const pc = $('pc');
      if (pc) renderPanel('explorer', pc);
      // 重新加载会话列表 + 刷新 Git
      loadSessions();
      const App = (window as any).App;
      if (App?.Git?.refreshGit) setTimeout(() => App.Git.refreshGit(), 300);
    }
  });
  else if (action === 'save' && api) { /* handled by Monaco Ctrl+S */ }
  else if (action === 'saveAll' && api) { /* handled by Monaco */ }
  else if (action === 'toggleAutoSave') {
    const v = localStorage.getItem('auto-save');
    if (v === '1') localStorage.removeItem('auto-save');
    else localStorage.setItem('auto-save', '1');
    toast('自动保存: ' + (v === '1' ? '关' : '开'));
  }
  else if (action === 'closeWindow' && api) api.close();
}

// ═══════════════════════════════════════════════════════════════════
//  CLI 启动
// ═══════════════════════════════════════════════════════════════════

function launchCli(): void {
  const api = (window as any).electronAPI as ElectronAPI | undefined;
  if (api && api.spawnTerminal) { api.spawnTerminal(); toast('已打开 CLI 终端窗口'); }
  else toast('请先启动 Electron 桌面应用');
}

// 公开 API
window.toggleFileMenu = toggleFileMenu;
window.closeFM = closeFM;
window.fileAction = fileAction as any;
window.launchCli = launchCli;

// ─── App 命名空间绑定 ──────────────────────────────────────
const AppFile = (window as any).App?.File;
if (AppFile) {
  AppFile.toggleFileMenu = toggleFileMenu;
  AppFile.closeFM = closeFM;
  AppFile.fileAction = fileAction;
  AppFile.launchCli = launchCli;
}
