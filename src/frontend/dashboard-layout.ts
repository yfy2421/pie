// Layout -- 组件组装器
function layout(): void {
  $('app')!.innerHTML = buildTopBar() + buildSideBar() + buildSidePanel() + buildMainArea();
  initResizeHandle();
  renderTabs();
  // Monaco 会覆盖 body 背景色为白色，强制还原
  document.body.style.background = 'var(--bg)';
  // 同步侧边栏按钮状态到当前 active panel
  document.querySelectorAll('.sbar .b[data-side]').forEach(b =>
    (b as HTMLElement).classList.toggle('on', (b as HTMLElement).dataset.side === window.__state._activePanel));
  const pc = $('pc');
  if (pc) renderPanel(window.__state._activePanel, pc);
  bind();
}

// ─── Top Bar ──────────────────────────────────────────────────
function buildTopBar(): string {
  return `<div class="topbar">
    <div class="nm"><span>PI</span></div>
    <div class="top-tabs">
      <button class="top-tab" onclick="toggleFileMenu(event)">文件</button>
    </div>
    <div class="win-controls">
      <button class="win-btn" onclick="winCtrl('minimize')">─</button>
      <button class="win-btn" onclick="winCtrl('maximize')">□</button>
      <button class="win-btn close" onclick="winCtrl('close')">✕</button>
    </div>
  </div>`;
}

// ─── Side Bar ─────────────────────────────────────────────────
function buildSideBar(): string {
  return `<div class="sbar">
    <button class="b" data-side="explorer" onclick="togglePanel('explorer')" title="资源管理器">${S('ifolder',20)}</button>
    <button class="b" data-side="chat" onclick="togglePanel('chat')" title="对话历史">${S('imsg',20)}</button>
    <button class="b" data-side="search" onclick="togglePanel('search')" title="搜索">${S('isearch',20)}</button>
    <button class="b" data-side="git" onclick="togglePanel('git')" title="Git">${S('igit',20)}</button>
    <div class="spcr"></div>
    <div class="bb">
      <button class="b" title="CLI" onclick="launchCli()">${S('iterm',20)}</button>
      <button class="b" title="设置" onclick="openSettingsModal()">${S('is',20)}</button>
    </div>
  </div>`;
}

// ─── Side Panel ───────────────────────────────────────────────
function buildSidePanel(): string {
  return `<div class="sinfo" id="si"><div class="panel-content" id="pc"></div><div class="sinfo-handle" id="si-handle"></div></div>`;
}

// ─── Main Area (tabs + content) ───────────────────────────────
function buildMainArea(): string {
  return `<div class="main">
    <div class="main-tabs" id="main-tabs"></div>
    <div class="mc">
      <div class="msgs" id="ms">${msgs()}</div>
      <div class="file-content" id="file-content" style="display:none">
        <div class="fc-toolbar"><span class="fc-status" id="fc-status"></span></div>
        <div class="fc-editor" id="fc-editor"></div>
      </div>
      <div class="fi-area" id="fi">
        <div class="fi-token-box" id="fi-token">
          <div class="fi-tk-top"><span class="fi-tk-hd">Tokens</span><span class="fi-tk-ctx" id="fi-tk-ctx">— / —</span></div>
          <div class="fi-tk-bar"><div class="fi-tk-fill" id="fi-tk-fill" style="width:0%"></div></div>
          <div class="fi-tk-grid" id="fi-tk-grid">
            <span class="fi-tk-l">输入</span><span class="fi-tk-v" id="fi-tk-in">—</span>
            <span class="fi-tk-l">输出</span><span class="fi-tk-v" id="fi-tk-out">—</span>
            <span class="fi-tk-l">命中</span><span class="fi-tk-v" id="fi-tk-ch">—</span>
            <span class="fi-tk-l">未命</span><span class="fi-tk-v" id="fi-tk-cm">—</span>
            <span class="fi-tk-l">命中率</span><span class="fi-tk-v" id="fi-tk-rate">—</span>
            <span class="fi-tk-sep"></span>
            <span class="fi-tk-l">费用</span><span class="fi-tk-v" id="fi-tk-cost">—</span>
          </div>
        </div>
        <div class="fi-box" id="fi-box">
          <div class="fi-drop-zone" id="fi-drop-zone">松开添加文件引用</div>
          <div class="fi-slash" id="fi-slash" style="display:none">
            <div class="fi-slash-item" data-cmd="/explain"><span class="cmd">/explain</span> <span class="desc">解释代码</span></div>
            <div class="fi-slash-item" data-cmd="/refactor"><span class="cmd">/refactor</span> <span class="desc">重构建议</span></div>
            <div class="fi-slash-item" data-cmd="/test"><span class="cmd">/test</span> <span class="desc">生成测试</span></div>
            <div class="fi-slash-item" data-cmd="/optimize"><span class="cmd">/optimize</span> <span class="desc">优化性能</span></div>
            <div class="fi-slash-item" data-cmd="/audit"><span class="cmd">/audit</span> <span class="desc">安全审计</span></div>
            <div class="fi-slash-item" data-cmd="/fix"><span class="cmd">/fix</span> <span class="desc">修复问题</span></div>
          </div>
          <div class="fi-attach-bar" id="fi-attach-bar" style="display:none"></div>
          <textarea id="ci" rows="1" placeholder="输入消息...（输入 / 使用快捷命令）" ${window.__state.IL?'disabled':''}></textarea>
          <div class="fi-divider"></div>
          <div class="fi-actions-bar">
            <button class="fi-abtn fi-model" id="fi-model-btn" title="切换模型"><span id="fi-model-name">claude-sonnet</span> <span class="fi-arrow">▾</span></button>
            <button class="fi-abtn fi-mode" id="fi-mode-btn" title="切换模式"><span id="fi-mode-name">自动</span> <span class="fi-arrow">▾</span></button>
            <button class="fi-abtn fi-file" id="fi-file-btn" title="添加本机文件">${window.S('iplus', 14)}</button>
            <span class="fi-spacer"></span>
            <button id="cs" class="fi-send-btn" title="${window.__state.IL?'中止':'发送消息'}">${window.S('iup', 16)}</button>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderTabs(): void {
  const el = $('main-tabs');
  if (!el) return;
  const active = window.__state._activeFileTab;
  const hasTabs = window.__state._fileTabs.length > 0;
  let scroll = '';
  scroll += `<div class="tb-item${active === null ? ' active' : ''}" data-tab="chat" onclick="switchTab(null)"><span class="tb-icon">${S('ic',13)}</span><span class="tb-label">对话</span></div>`;
  for (let i = 0; i < window.__state._fileTabs.length; i++) {
    const ft = window.__state._fileTabs[i];
    const icon = ExplorerService.iconFor(ft.label, false);
    scroll += `<div class="tb-item${ft.id === active ? ' active' : ''}" draggable="true" data-tab-index="${i}" data-tab="${E(ft.id)}" onclick="switchTab('${E(ft.id)}')" oncontextmenu="tabContextMenu(event,'${E(ft.id)}')">
      <span class="tb-icon">${icon}</span>
      <span class="tb-label">${E(ft.label)}</span>
      <span class="tb-close" onclick="event.stopPropagation();closeFileTab('${E(ft.id)}')">✕</span>
    </div>`;
  }
  el.innerHTML = `<div class="tb-scroll">${scroll}</div>${hasTabs ? '<div class="tb-more" onclick="tabMoreMenu(event)" title="更多操作">···</div>' : ''}`;
  // 拖拽排序
  if (hasTabs) setupTabDrag(el);
}

const FILE_TABS_KEY = 'file-tabs';
const LAST_ACTIVE_KEY = 'last-active-tab';
const LAST_SESSION_KEY = 'last-session-id';

function switchTab(fileId: string | null): void {
  window.__state._activeFileTab = fileId;
  const ms = $('ms');
  const fc = $('file-content');
  const fi = $('fi');
  const mc = document.querySelector('.mc');
  if (fileId === null) {
    // 对话 tab
    if (ms) ms.style.display = '';
    if (fc) fc.style.display = 'none';
    if (fi) fi.style.display = '';
    mc?.classList.remove('editing');
  } else {
    // 文件 tab
    if (ms) ms.style.display = 'none';
    if (fc) fc.style.display = '';
    if (fi) fi.style.display = 'none';
    mc?.classList.add('editing');
    const tab = window.__state._fileTabs.find(t => t.id === fileId);
    const editorEl = $('fc-editor');
    if (editorEl && tab) {
      // Monaco 初始化或更新
      const m = (window as any).__monaco;
      if (m) {
        if (!editorEl.dataset.monacoReady) {
          editorEl.innerHTML = '';
          m.create(editorEl);
          editorEl.dataset.monacoReady = '1';
        }
        m.setValue(tab.content);
        m.setLang(tab.id);
      }
    }
  }
  renderTabs();
  // Persist last active tab
  try { localStorage.setItem(LAST_ACTIVE_KEY, fileId ?? '__chat__'); } catch {}
}

function _saveFileTabs(): void {
  try {
    localStorage.setItem(FILE_TABS_KEY, JSON.stringify(
      window.__state._fileTabs.map(t => ({ id: t.id, label: t.label, lang: t.lang }))
    ));
  } catch {}
}

function openFileTab(id: string, content: string, lang?: string): void {
  const label = id.split('/').pop() || id;
  const existing = window.__state._fileTabs.findIndex(t => t.id === id);
  if (existing !== -1) {
    window.__state._fileTabs[existing].content = content;
    window.__state._fileTabs[existing].lang = lang || '';
  } else {
    window.__state._fileTabs.push({ id, label, content, lang: lang || '' });
  }
  _saveFileTabs();
  switchTab(id);
}

function closeFileTab(id: string): void {
  const idx = window.__state._fileTabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  // 通知 tsserver 文件已关闭
  const monaco = (window as any).__monaco;
  if (monaco?.tsCloseFile) monaco.tsCloseFile(id);
  window.__state._fileTabs.splice(idx, 1);
  _saveFileTabs();
  if (window.__state._activeFileTab === id) {
    switchTab(window.__state._fileTabs.length > 0 ? window.__state._fileTabs[Math.min(idx, window.__state._fileTabs.length - 1)].id : null);
  } else {
    renderTabs();
  }
}

// ─── 文件编辑 ──────────────────────────────────────────
function saveCurrentFile(): Promise<void> {
  const id = window.__state._activeFileTab;
  if (!id) return Promise.resolve();
  const m = (window as any).__monaco;
  const content = m?.getValue() ?? '';
  if (!content && !m) return Promise.resolve();
  const status = $('fc-status');
  if (status) status.textContent = '保存中...';
  const ws = ExplorerService.getWorkspacePath();
  return fetch('/api/file/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: ws, path: id, content }),
  }).then(r => r.json()).then(d => {
    if (!d.error) {
      if (status) { status.textContent = '已保存'; setTimeout(() => { if (status) status.textContent = ''; }, 2000); }
      const tab = window.__state._fileTabs.find(t => t.id === id);
      if (tab) tab.content = content;
    } else {
      if (status) status.textContent = '保存失败: ' + d.error;
    }
  }).catch(() => { if (status) status.textContent = '保存失败'; });
}
// Ctrl+S 保存
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    const fc = $('file-content');
    if (fc && fc.style.display !== 'none') { e.preventDefault(); saveCurrentFile(); }
  }
});
(window as any).saveCurrentFile = saveCurrentFile;

// 恢复上次的标签页
function restoreFileTabs(): void {
  try {
    // Save intended target BEFORE openFileTab's switchTab overwrites it
    const intendedTarget = localStorage.getItem(LAST_ACTIVE_KEY) ?? '__chat__';
    const raw = localStorage.getItem(FILE_TABS_KEY);
    if (!raw) { restoreActiveTabWith(intendedTarget); return; }
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) { restoreActiveTabWith(intendedTarget); return; }
    window.__state._fileTabs = [];
    let loaded = 0;
    const total = saved.length;
    for (const st of saved) {
      // 重新获取内容
      const ws = ExplorerService.getWorkspacePath();
      if (ws) {
        fetch(`/api/file/read?root=${encodeURIComponent(ws)}&path=${encodeURIComponent(st.id)}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (!d) return;
            const content = d.encoding === 'base64' ? '[二进制文件，无法预览]' : d.content;
            openFileTab(st.id, content, st.lang || '');
          })
          .catch(() => {})
          .finally(() => {
            loaded++;
            if (loaded >= total) restoreActiveTabWith(intendedTarget);
          });
      } else {
        loaded++;
        if (loaded >= total) restoreActiveTabWith(intendedTarget);
      }
    }
    if (total === 0) restoreActiveTabWith(intendedTarget);
  } catch {}
}

function restoreActiveTabWith(target: string): void {
  try {
    if (target === '__chat__' || !target) {
      switchTab(null);
      setTimeout(() => { (window as any).restoreLastSession?.(); }, 100);
    } else {
      const exists = window.__state._fileTabs.some(t => t.id === target);
      if (exists) switchTab(target);
      else { switchTab(null); setTimeout(() => { (window as any).restoreLastSession?.(); }, 100); }
    }
  } catch { switchTab(null); }
}

// 页面加载完成后恢复标签页
document.addEventListener('DOMContentLoaded', () => setTimeout(restoreFileTabs, 500));

// ─── Side Panel Navigation ────────────────────────────────────
function togglePanel(name: string): void {
  const si = $('si'), pc = $('pc');
  if (!si || !pc) return;
  if (window.__state._activePanel === name && !si.classList.contains('closed')) {
    si.classList.add('closed');
    document.querySelectorAll('.sbar .b[data-side]').forEach(b => (b as HTMLElement).classList.remove('on'));
    return;
  }
  window.__state._activePanel = name;
  si.classList.remove('closed');
  si.style.width = '260px';
  document.querySelectorAll('.sbar .b[data-side]').forEach(b => (b as HTMLElement).classList.toggle('on', (b as HTMLElement).dataset.side === name));
  renderPanel(name, pc);
}

function initResizeHandle(): void {
  const handle = $('si-handle'), si = $('si');
  if (!handle || !si) return;
  handle.onmousedown = function (e: MouseEvent) {
    e.preventDefault();
    si!.classList.add('dragging');
    const startX = e.clientX, startW = si!.offsetWidth;
    const appRect = document.querySelector('.app')!.getBoundingClientRect();
    const maxW = appRect.width * 0.8 - 60;
    function onMove(ev: MouseEvent) {
      let newW = startW + (ev.clientX - startX);
      newW = Math.max(0, Math.min(newW, maxW));
      si!.style.width = newW + 'px';
      si!.classList.remove('closed');
    }
    function onUp() {
      si!.classList.remove('dragging');
      if (si!.offsetWidth < 20) { si!.classList.add('closed'); si!.style.width = ''; }
      document.removeEventListener('mousemove', onMove as any);
      document.removeEventListener('mouseup', onUp as any);
    }
    document.addEventListener('mousemove', onMove as any);
    document.addEventListener('mouseup', onUp as any);
  };
}

// ─── Panel Content Router（使用 pane 注册系统）──────────────────
function renderPanel(name: string, pc?: HTMLElement | null): void {
  if (!pc) pc = $('pc');
  if (!pc) return;

  const paneFn = getPane(name);
  if (paneFn) { paneFn(pc); return; }

  pc.innerHTML = `<div class="sg-item dim">面板 "${E(name)}" 未注册</div>`;
}

// ─── Status Panel ─────────────────────────────────────────────
function sinfoHTML(): string {
  const stD = window.__state.D;
  if (!stD) return '<div class="sg" style="padding:12px;font-size:.7rem;color:var(--tm)">加载中...</div>';
  const ts = (stD.tools || ['read','write','edit','bash']).slice(0, 18);
  const act = (stD.activeTools || stD.tools || []).length;
  return `<div class="sg"><div class="sg-t">模型</div>
    <div class="sg-r" data-model="provider"><span class="l">提供商</span><span class="v">${E(stD.modelProvider||'N/A')}</span></div>
    <div class="sg-r" data-model="id"><span class="l">模型</span><span class="v" title="${E(stD.modelId||'')}">${E((stD.modelId||'').split('/').pop()||'N/A')}</span></div>
    <div class="sg-r"><span class="l">上下文</span><span class="v">${E(stD.modelContextWindow||'N/A')}</span></div>
    <div class="sg-r"><span class="l">输出上限</span><span class="v">${E(stD.modelMaxTokens||'N/A')}</span></div>
    <div class="sg-r"><span class="l">思考</span><span class="v p">${E(stD.thinkingLevel||'off')}</span></div></div>
    <div class="sg"><div class="sg-t">会话</div>
    <div class="sg-r"><span class="l">运行</span><span class="v">${F(stD.runtime||0)}</span></div>
    <div class="sg-r"><span class="l">消息</span><span class="v">${stD.messagesCount||0}</span></div>
    <div class="sg-r"><span class="l">状态</span><span class="v p">${stD.isIdle===false?'响应中':'空闲'}</span></div></div>
    <div class="sg"><div class="sg-t">工具 (${act})</div>
    ${ts.map(t=>'<span class="sg-tag">'+E(t)+'</span>').join('')}${ts.length<act?'<span class="sg-tag" style="opacity:.5">+'
    +(act-ts.length)+'</span>':''}</div>
    <div class="sg"><div class="sg-t">存储</div><div class="sg-p">${E(stD.dataDir||'data/')}</div></div>`;
}
function refreshSinfo(): void {
  const si = $('si');
  if (si) si.innerHTML = sinfoHTML();
  const modelEls = si?.querySelectorAll('.sg-r[data-model]');
  if (modelEls) modelEls.forEach(el => { (el as HTMLElement).style.cursor = 'pointer'; (el as HTMLElement).onclick = showModelPicker as any; });
}

// ─── 标签栏拖拽排序 ────────────────────────────
function setupTabDrag(el: HTMLElement): void {
  const scroll = el.querySelector('.tb-scroll') as HTMLElement | null;
  if (!scroll) return;
  let dragIdx = -1;
  function clearIndicators() { scroll.querySelectorAll('.tb-drop').forEach(e => e.classList.remove('tb-drop')); }
  scroll.addEventListener('dragstart', (e: DragEvent) => {
    const item = (e.target as HTMLElement).closest('.tb-item') as HTMLElement | null;
    if (!item) return; dragIdx = parseInt(item.dataset.tabIndex || '-1');
    e.dataTransfer?.setData('text/tab-index', String(dragIdx));
    e.dataTransfer!.effectAllowed = 'move';
    item.style.opacity = '0.3';
  });
  scroll.addEventListener('dragend', () => { clearIndicators(); scroll.querySelectorAll('.tb-item').forEach(el => (el as HTMLElement).style.opacity = ''); dragIdx = -1; });
  scroll.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault(); clearIndicators();
    const items = scroll.querySelectorAll('.tb-item');
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      const midX = r.left + r.width / 2;
      if (e.clientX < midX) { items[i].classList.add('tb-drop'); return; }
    }
    // 拖到最后之后视为插入到末尾
    items[items.length - 1]?.classList.add('tb-drop');
  });
  scroll.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault(); clearIndicators();
    const srcIdx = parseInt(e.dataTransfer?.getData('text/tab-index') || '-1');
    if (srcIdx < 0) return;
    const items = scroll.querySelectorAll('.tb-item');
    let dstIdx = items.length - 1;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width / 2) { dstIdx = i; break; }
    }
    const tabs = window.__state._fileTabs;
    if (srcIdx === dstIdx) return;
    const [moved] = tabs.splice(srcIdx, 1);
    tabs.splice(dstIdx > srcIdx ? dstIdx - 1 : dstIdx, 0, moved);
    renderTabs();
  });
}

// ─── 标签栏鼠标滚轮滚动 ────────────────────────
// 让 tb-scroll 支持横向滚轮滚动
document.addEventListener('wheel', (e) => {
  const target = (e.target as HTMLElement).closest('.tb-scroll') as HTMLElement | null;
  if (!target) return;
  target.scrollLeft += e.deltaY;
}, { passive: true });

// ─── 标签栏右键菜单 ────────────────────────────────
function tabContextMenu(e: MouseEvent, id: string): void {
  e.preventDefault();
  // 清除已有菜单
  document.querySelectorAll('.ctx-menu').forEach(el => el.remove());
  const tabs = window.__state._fileTabs;
  const idx = tabs.findIndex(t => t.id === id);
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  const items: { label: string; action: () => void }[] = [
    { label: '关闭', action: () => closeFileTab(id) },
    { label: '关闭其他', action: () => { for (let i = tabs.length - 1; i >= 0; i--) if (tabs[i].id !== id) closeFileTab(tabs[i].id); } },
    { label: '关闭右侧', action: () => { for (let i = tabs.length - 1; i > idx; i--) closeFileTab(tabs[i].id); } },
    { label: '关闭所有', action: () => { for (let i = tabs.length - 1; i >= 0; i--) closeFileTab(tabs[i].id); } },
    { label: '-', action: () => {} },
    { label: '复制路径', action: () => { navigator.clipboard.writeText(id).then(() => toast('已复制路径')).catch(() => toast('复制失败', 'error')); } },
  ];
  for (const a of items) {
    if (a.label === '-') { const s = document.createElement('div'); s.className = 'ctx-sep'; menu.appendChild(s); continue; }
    const item = document.createElement('div');
    item.className = 'ctx-item'; item.textContent = a.label;
    item.onclick = () => { menu.remove(); a.action(); };
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}
// 标签栏更多操作按钮菜单
function tabMoreMenu(e: MouseEvent): void {
  document.querySelectorAll('.ctx-menu').forEach(el => el.remove());
  const tabs = window.__state._fileTabs;
  // 菜单高度：最多显示 15 个标签，超出滚动
  const maxH = Math.min(tabs.length * 28 + 70, 450);
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  let x = e.clientX, y = e.clientY + 4;
  const mw = 200;
  if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
  if (y + maxH > window.innerHeight) y = window.innerHeight - maxH - 4;
  menu.style.left = x + 'px'; menu.style.top = y + 'px'; menu.style.maxHeight = maxH + 'px'; menu.style.overflowY = 'auto';

  // 操作项
  const actions: { label: string; fn: () => void }[] = [
    { label: '关闭全部标签页', fn: () => { for (let i = tabs.length - 1; i >= 0; i--) closeFileTab(tabs[i].id); } },
    { label: '关闭已保存标签页', fn: () => { for (let i = tabs.length - 1; i >= 0; i--) closeFileTab(tabs[i].id); } },
  ];
  for (const a of actions) {
    const item = document.createElement('div'); item.className = 'ctx-item'; item.textContent = a.label;
    item.onclick = () => { menu.remove(); a.fn(); }; menu.appendChild(item);
  }
  // 分隔线 + 标签列表（带图标和关闭按钮）
  if (tabs.length > 0) {
    const sep = document.createElement('div'); sep.className = 'ctx-sep'; menu.appendChild(sep);
    for (const ft of tabs) {
      const item = document.createElement('div'); item.className = 'ctx-tab-item';
      const active = ft.id === window.__state._activeFileTab;
      if (active) item.style.color = 'var(--am)';
      item.innerHTML = `<span class="ctx-tab-icon">${ExplorerService.iconFor(ft.label, false)}</span><span class="ctx-tab-label">${E(ft.label)}</span><span class="ctx-tab-close">✕</span>`;
      item.querySelector('.ctx-tab-close')!.addEventListener('click', (ce) => { ce.stopPropagation(); menu.remove(); closeFileTab(ft.id); });
      item.addEventListener('click', () => { menu.remove(); switchTab(ft.id); });
      menu.appendChild(item);
    }
  }
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}
(window as any).tabContextMenu = tabContextMenu;
(window as any).tabMoreMenu = tabMoreMenu;
window.layout = layout;
window.togglePanel = togglePanel;
window.renderPanel = renderPanel;
window.sinfoHTML = sinfoHTML;
(window as any).refreshSinfo = refreshSinfo;
(window as any).renderTabs = renderTabs;
(window as any).switchTab = switchTab;
(window as any).openFileTab = openFileTab;
(window as any).closeFileTab = closeFileTab;

// ─── App 命名空间绑定 ──────────────────────────────────────
const AppLayout = (window as any).App?.UI;
if (AppLayout) {
  AppLayout.layout = layout;
  AppLayout.togglePanel = togglePanel;
  AppLayout.renderPanel = renderPanel;
  AppLayout.sinfoHTML = sinfoHTML;
  AppLayout.refreshSinfo = refreshSinfo;
  AppLayout.renderTabs = renderTabs;
  AppLayout.switchTab = switchTab;
  AppLayout.openFileTab = openFileTab;
  AppLayout.closeFileTab = closeFileTab;
  AppLayout.saveCurrentFile = saveCurrentFile;
}
