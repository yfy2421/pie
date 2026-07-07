// ═══════════════════════════════════════════════════════════════════
//  会话管理
// ═══════════════════════════════════════════════════════════════════

interface SessionInfo {
  id: string;
  name: string;
  active: boolean;
  messageCount: number;
  createdAt: string;
  file: string;
}

let _loadRetries = 0;
const MAX_LOAD_RETRIES = 8;
function loadSessions(): void {
  const t0 = Date.now();
  const el = $('sl');
  if (!el) { _loadRetries++; if (_loadRetries > MAX_LOAD_RETRIES) return; console.log(`⏳ loadSessions retry #${_loadRetries}: no #sl`); setTimeout(loadSessions, 500); return; }
  _loadRetries = 0;
  const ws = localStorage.getItem('workspace_path') || '';
  console.log(`📋 loadSessions ws="${ws}"`);
  fetch('/api/sessions?workspace=' + encodeURIComponent(ws) + '&other=1').then(r => r.json()).then((data: { sessions?: SessionInfo[]; other?: { project: string; sessions: SessionInfo[] }[]; error?: string }) => {
    console.log(`📋 loadSessions done in ${Date.now()-t0}ms, sessions=${data.sessions?.length}, other=${data.other?.length}`);
    if (!el) return;
    if (data.error) { el.innerHTML = `<div class="sg-item dim">${E(data.error)}</div>`; return; }
    if ((!data.sessions || data.sessions.length === 0) && (!data.other || data.other.length === 0)) {
      el.innerHTML = '<div class="sg-item dim">暂无会话</div>'; return;
    }

    let html = '';
    // Current project sessions
    const sessions = data.sessions || [];
    html += `<div style="font-size:.6rem;color:var(--am);margin-bottom:4px">${sessions.length > 0 ? sessions.length + ' 个会话' : '无会话'}</div>`;
    html += sessions.map(s => {
      const name = s.name || '未命名会话';
      const msgs = s.messageCount + ' 条消息';
      const cls = s.active ? ' active' : '';
      return `<div class="sess-item${cls}" onclick="switchSession('${s.id}')">
        <div class="sess-info"><div class="sess-name">${E(name)}</div><div class="sess-meta">${msgs}</div></div>
        <div class="sess-ops">
          <button class="sess-rename" onclick="event.stopPropagation();renameSession(this,'${s.id}')">✎</button>
          <button class="sess-del" onclick="event.stopPropagation();deleteSession('${s.id}')">✕</button>
        </div>
      </div>`;
    }).join('');

    // Other projects
    const others = data.other || [];
    if (others.length > 0) {
      html += `<div class="sess-other-header" onclick="toggleOtherSessions(this)">▸ 其他项目 (${others.length})</div>`;
      html += `<div class="sess-other-list" style="display:none">`;
      for (const proj of others) {
        const projLabel = proj.project === "未分类" ? "未分类（旧会话）" : E(proj.project);
        const projPath = proj.path ? ` <span style="font-size:.55rem;color:var(--tm);font-family:var(--fm)">${E(proj.path)}</span>` : '';
        html += `<div style="font-size:.6rem;color:var(--tm);padding:6px 4px 2px;font-family:var(--fd)">${projLabel}${projPath}</div>`;
        html += proj.sessions.map(s => {
          const name = s.name || '未命名会话';
          const msgs = s.messageCount + ' 条消息';
          return `<div class="sess-item" onclick="switchSession('${s.id}')">
            <div class="sess-info"><div class="sess-name">${E(name)}</div><div class="sess-meta">${msgs}</div></div>
            <div class="sess-ops">
              <button class="sess-rename" onclick="event.stopPropagation();renameSession(this,'${s.id}')">✎</button>
              <button class="sess-del" onclick="event.stopPropagation();deleteSession('${s.id}')">✕</button>
            </div>
          </div>`;
        }).join('');
      }
      html += `</div>`;
    }

    el.innerHTML = html;
  }).catch(() => { const el = $('sl'); if (el) el.innerHTML = '<div class="sg-item dim">网络错误</div>'; toast('加载会话列表失败', 'error'); });
}

function toggleOtherSessions(header: HTMLElement): void {
  const list = header.nextElementSibling as HTMLElement | null;
  if (!list) return;
  const isOpen = list.style.display !== 'none';
  list.style.display = isOpen ? 'none' : 'block';
  header.textContent = (isOpen ? '▸' : '▾') + ' 其他项目';
}

function newSession(): void {
  if (window.__state.M.length > 0) {
    fetch('/api/sessions/save', { method: 'POST' }).catch(() => { toast('保存当前会话失败', 'error'); });
  }
  const ws = localStorage.getItem('workspace_path') || '';
  window.__state.M = [];
  const msgsEl = $('ms');
  if (msgsEl) msgsEl.innerHTML = '<div class="wl"><h2>💬 新会话</h2><p>输入消息开始新的对话</p></div>';
  toast('已开启新会话', 'success');
  loadSessions();
  // Record workspace for new sessions
  fetch('/api/sessions/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: ws }) }).catch(() => {});
}

function renameSession(el: HTMLElement, id: string): void {
  let item: HTMLElement | null = el;
  while (item && !item.classList.contains('sess-item')) item = item.parentNode as HTMLElement | null;
  if (!item) { toast('请稍后重试'); return; }
  const nameEl = item.querySelector('.sess-name') as HTMLElement | null;
  if (!nameEl) { toast('请稍后重试'); return; }
  const oldName = nameEl.textContent || '';
  const input = document.createElement('input');
  input.type = 'text'; input.value = oldName;
  input.className = 'sess-rename-input';
  input.style.cssText = 'width:100%;padding:2px 4px;border-radius:4px;border:1px solid var(--am);background:var(--bc);color:var(--tx);font-size:.72rem;font-family:var(--fb);outline:none;box-sizing:border-box';
  nameEl.innerHTML = ''; nameEl.appendChild(input);
  input.focus(); input.select();
  const nm = nameEl; // 闭包捕获，类型已收窄
  function save(): void {
    const val = input.value.trim();
    if (val && val !== oldName) {
      fetch('/api/sessions/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: val }) })
        .then(r => r.json()).then((r: { ok: boolean }) => {
          if (r.ok) { toast('已重命名'); loadSessions(); }
          else { nm.textContent = oldName; toast('重命名失败'); }
        }).catch(() => { nm.textContent = oldName; toast('重命名失败'); });
    } else { nm.textContent = oldName; }
  }
  input.onkeydown = function (e: KeyboardEvent) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } };
  input.onblur = save;
}

async function deleteSession(id: string): void {
  const ok = await confirmAsync('确定删除此会话？');
  if (!ok) return;
  const t0 = Date.now();
  console.log(`🗑️ Deleting session: ${id}`);
  fetch('/api/sessions/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    .then(r => r.json()).then((r: { ok: boolean }) => {
      if (r.ok) {
        console.log(`🗑️ Session deleted in ${Date.now()-t0}ms`);
        toast('已删除');
        // 彻底关闭 SSE 连接（必须先清回调再 close，否则 onerror 会重置 IL）
        const oldCS = window.__state.CS;
        if (oldCS) { oldCS.onmessage = null; oldCS.onerror = null; oldCS.close(); window.__state.CS = null; }
        window.__state.M = [];
        window.__state.IL = false;
        // 异步延迟 DOM 操作，让 Electron 合成器有机会刷新
        setTimeout(() => {
          try { const m = (window as any).__monaco; m?.pauseDiags?.(); m?.blur?.(); } catch {}
          const activeTab = window.__state._activeFileTab;
          if (activeTab !== null) switchTab(null);
          const msgsEl = $('ms');
          if (msgsEl) { msgsEl.innerHTML = msgs(); msgsEl.scrollTop = 0; }
          const ci = $('ci') as HTMLTextAreaElement | null;
          if (ci) { ci.disabled = false; ci.value = ''; ci.style.height = 'auto'; }
          const cs = $('cs') as HTMLButtonElement | null;
          if (cs) { cs.disabled = false; cs.title = '发送消息'; cs.innerHTML = window.S('iz', 16); }
          console.log(`  UI reset done at ${Date.now()}`);
        }, 50);
        loadSessions();
      }
      else toast('删除失败');
    }).catch((err) => { console.error('🗑️ Delete failed:', err); toast('删除失败'); });
}

function switchSession(id: string): void {
  fetch('/api/sessions/' + encodeURIComponent(id) + '/messages').then(r => r.json()).then((data: { messages?: Array<{ role: string; content: string }>; error?: string }) => {
    if (data.error) { toast('加载失败: ' + data.error); return; }
    if (!data.messages || data.messages.length === 0) { toast('会话为空'); return; }
    window.__state.M = data.messages.map(m => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.content }));
    const msgsEl = $('ms');
    if (msgsEl) { msgsEl.innerHTML = msgs(); setTimeout(() => { msgsEl.scrollTop = msgsEl.scrollHeight; }, 50); }
    toast('已切换到会话 (' + window.__state.M.length + ' 条消息)');
    try { localStorage.setItem('last-session-id', id); } catch {}
    loadSessions();
  }).catch(() => toast('加载失败'));
}

// Restore last session on startup (called after DOM ready)
function restoreLastSession(): void {
  try {
    if (localStorage.getItem('no-restore-session') === '1') return;
    const id = localStorage.getItem('last-session-id');
    if (id) switchSession(id);
  } catch {}
}

// 公开 API
window.loadSessions = loadSessions;
window.newSession = newSession;
window.renameSession = renameSession as any;
window.deleteSession = deleteSession;
window.switchSession = switchSession;
window.restoreLastSession = restoreLastSession;

// ─── App 命名空间绑定 ──────────────────────────────────────
const AppSess = (window as any).App?.Session;
if (AppSess) {
  AppSess.loadSessions = loadSessions;
  AppSess.newSession = newSession;
  AppSess.renameSession = renameSession;
  AppSess.deleteSession = deleteSession;
  AppSess.switchSession = switchSession;
}
