// ═══════════════════════════════════════════════════════════════════
//  消息渲染 & 流式追加
// ═══════════════════════════════════════════════════════════════════

/** 渲染 markdown 为 HTML（过滤可能影响布局的标签） */
function mdRender(text: string): string {
  const md = (window as any).marked as typeof import("marked") | undefined;
  if (!md || !text) return E(text || '');
  try {
    const html = md.parse(text, { breaks: true, gfm: true });
    // 过滤 <link> 标签（AI 输出的内容可能包含，导致 404 加载请求）
    return html.replace(/<link[^>]*>/gi, '');
  } catch {
    return E(text);
  }
}

function msgs(): string {
  const M = window.__state.M;
  if (M.length === 0) return '<div class="wl"><h2>Pi — 你的代码助手</h2><p>在下方输入，开始编码</p></div>';
  return M.map(m => {
    const c = m.role + (m.streaming ? ' go' : ''), lb = m.role === 'user' ? '你' : 'Pi';
    const ty = m.streaming ? `<div class="ty"><span class="ty-d"></span><span class="ty-d"></span><span class="ty-d"></span></div>` : '';
    const content = m.content ? mdRender(m.content) : '';
    return `<div class="m ${c}"><div class="ml">${lb}</div><div class="mt">${content}</div>${ty}</div>`;
  }).join('\n');
}

function appendDelta(text: string): void {
  const M = window.__state.M;
  const msgsEl = $('ms');
  if (!msgsEl) return;
  const last = M[M.length - 1];
  if (!last) return;
  last.content += text;
  const msgDivs = msgsEl.querySelectorAll('.m');
  const lastMsg = msgDivs[msgDivs.length - 1];
  if (lastMsg) {
    const cd = lastMsg.querySelector('.mt');
    if (cd) { cd.innerHTML = mdRender(last.content); return; }
  }
  msgsEl.innerHTML = msgs();
}

// ═══════════════════════════════════════════════════════════════════
//  Slash Command Popup
// ═══════════════════════════════════════════════════════════════════

function handleSlash(ci: HTMLTextAreaElement): void {
  const slashEl = $('fi-slash');
  if (!slashEl) return;
  const val = ci.value;
  // Show when input starts with "/" and no space yet (command not fully typed)
  if (val.startsWith('/') && !val.includes(' ')) {
    slashEl.style.display = 'flex';
    // Highlight matching item
    slashEl.querySelectorAll('.fi-slash-item').forEach(item => {
      const cmd = (item as HTMLElement).dataset.cmd || '';
      const match = cmd.startsWith(val);
      (item as HTMLElement).style.background = match ? 'var(--bc)' : '';
      (item as HTMLElement).style.color = match ? 'var(--tx)' : '';
    });
  } else {
    slashEl.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  Token Display
// ═══════════════════════════════════════════════════════════════════

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k';
  return (n / 1000000).toFixed(1) + 'M';
}

// ─── Currency helpers ────────────────────────────────────
const CNY_PER_USD = 7.2;

const CURRENCY_MAP: Record<string, { sym: string; rate: number }> = {
  deepseek: { sym: '¥', rate: CNY_PER_USD },
  moonshot: { sym: '¥', rate: CNY_PER_USD },
  'zhipu-ai': { sym: '¥', rate: CNY_PER_USD },
  baidu: { sym: '¥', rate: CNY_PER_USD },
  alibaba: { sym: '¥', rate: CNY_PER_USD },
  bytedance: { sym: '¥', rate: CNY_PER_USD },
  '01-ai': { sym: '¥', rate: CNY_PER_USD },
};

function formatCost(costUsd: number | null | undefined, provider: string): string {
  if (costUsd == null) return '—';
  const info = CURRENCY_MAP[provider.toLowerCase()] || { sym: '$', rate: 1 };
  const converted = costUsd * info.rate;
  if (converted < 0.01) return info.sym + converted.toFixed(6);
  if (converted < 1) return info.sym + converted.toFixed(4);
  return info.sym + converted.toFixed(2);
}

function updateTokenDisplay(cu: any, ss: any, provider?: string): void {
  // Context usage
  const ctxEl = $('fi-tk-ctx');
  const fillEl = $('fi-tk-fill');
  if (ctxEl && cu) {
    const used = cu.tokens, limit = cu.contextWindow;
    ctxEl.textContent = (used != null ? fmt(used) : '—') + ' / ' + (limit ? fmt(limit) : '—');
    if (fillEl) fillEl.style.width = (cu.percent ?? 0) + '%';
  }

  // Session stats
  const t = ss?.tokens;
  if (!t) return;
  setText('fi-tk-in', fmt(t.input));
  setText('fi-tk-out', fmt(t.output));
  setText('fi-tk-ch', fmt(t.cacheRead));
  setText('fi-tk-cm', fmt(t.cacheWrite));
  // Cache hit rate
  const total = (t.cacheRead || 0) + (t.cacheWrite || 0);
  setText('fi-tk-rate', total > 0 ? Math.round((t.cacheRead || 0) / total * 100) + '%' : '—');
  // Cost
  if (ss.cost != null) setText('fi-tk-cost', formatCost(ss.cost, provider || ''));
}

function setText(id: string, text: string): void {
  const el = $(id);
  if (el) el.textContent = text;
}

// ─── Token polling ───────────────────────────────────────

async function pollTokenUsage(): Promise<void> {
  try {
    const r = await fetch('/api/token-usage');
    const data = await r.json();
    if (data) updateTokenDisplay(data.contextUsage, data.sessionStats, data.provider);
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════
//  Mode & Effort — 模式选择（自动/解释/计划）
// ═══════════════════════════════════════════════════════════════════

const MODE_LABELS: Record<string, string> = { auto: '自动', explain: '解释', plan: '计划' };
const EFFORT_LABELS: Record<string, string> = { low: '低', medium: '中', high: '高', xhigh: '极高', max: '最高' };

const MODE_INSTRUCTIONS: Record<string, string> = {
  auto: '',
  explain: '仅解释，不要修改任何文件或执行命令。',
  plan: '不要执行任何操作。输出结构化方案：目标 → 步骤 → 涉及文件 → 风险。',
};

const EFFORT_INSTRUCTIONS: Record<string, string> = {
  low: '简要回答即可。',
  medium: '',
  high: '请深入分析，考虑边界情况。',
  xhigh: '请进行深度分析，考虑多种可能性和边界情况。',
  max: '请穷尽所有可能性，进行彻底分析和验证。',
};

let _currentMode = 'auto';
let _currentEffort = 'medium';

function loadModeState(): void {
  try {
    _currentMode = localStorage.getItem('chat-mode') || 'auto';
    _currentEffort = localStorage.getItem('chat-effort') || 'medium';
    if (!MODE_LABELS[_currentMode]) _currentMode = 'auto';
    if (!EFFORT_LABELS[_currentEffort]) _currentEffort = 'medium';
  } catch { _currentMode = 'auto'; _currentEffort = 'medium'; }
  updateModeButton();
}

function setMode(mode: string): void {
  _currentMode = mode;
  try { localStorage.setItem('chat-mode', mode); } catch {}
  updateModeButton();
}

function setEffort(effort: string): void {
  _currentEffort = effort;
  try { localStorage.setItem('chat-effort', effort); } catch {}
}

function updateModeButton(): void {
  const el = $('fi-mode-name');
  if (el) el.textContent = MODE_LABELS[_currentMode] || '自动';
}

function showModePopup(btn: HTMLElement): void {
  const existing = document.getElementById('mode-popup');
  if (existing) { existing.remove(); return; }
  const rect = btn.getBoundingClientRect();
  const popup = document.createElement('div');
  popup.id = 'mode-popup';
  popup.style.cssText = `position:fixed;bottom:${window.innerHeight - rect.top + 4}px;left:${rect.left}px;z-index:999;background:var(--be);border:1px solid var(--bd);border-radius:8px;padding:6px;min-width:160px;box-shadow:0 8px 32px var(--sd)`;

  let html = '<div style="font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--tm);padding:4px 8px;font-family:var(--fd)">模式</div>';
  for (const [key, label] of Object.entries(MODE_LABELS)) {
    const active = key === _currentMode;
    html += `<div class="mode-popup-item" data-mode="${key}" style="${active?'background:rgba(245,158,11,.1);color:var(--am);font-weight:600':''}">${label} ${active ? '✓' : ''}</div>`;
  }
  html += '<div style="font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--tm);padding:8px 8px 3px;font-family:var(--fd);margin-top:4px;border-top:1px solid var(--bd)">思考深度</div>';
  html += '<div style="padding:4px 8px">';
  html += '<div style="display:flex;gap:2px">';
  for (const [key, label] of Object.entries(EFFORT_LABELS)) {
    const active = key === _currentEffort;
    html += `<div class="mode-effort-item" data-effort="${key}" style="flex:1;text-align:center;padding:3px 0;border-radius:4px;font-size:.65rem;cursor:pointer;${active?'background:var(--am);color:#0A0A0F;font-weight:600':'color:var(--ts)'}">${label}</div>`;
  }
  html += '</div></div>';

  popup.innerHTML = html;
  document.body.appendChild(popup);

  // Mode click
  popup.querySelectorAll('.mode-popup-item').forEach(el => {
    el.addEventListener('click', () => {
      const mode = (el as HTMLElement).dataset.mode || 'auto';
      setMode(mode);
      popup.remove();
    });
  });
  // Effort click
  popup.querySelectorAll('.mode-effort-item').forEach(el => {
    el.addEventListener('click', () => {
      const effort = (el as HTMLElement).dataset.effort || 'medium';
      setEffort(effort);
      popup.remove();
    });
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function close(ev) {
      if (!popup.contains(ev.target as Node) && ev.target !== btn) {
        popup.remove();
        document.removeEventListener('click', close, true);
      }
    }, true);
  }, 0);
}

/** 根据当前 mode/effort 构建消息指令前缀 */
function buildInstruction(message: string): string {
  const modeIns = MODE_INSTRUCTIONS[_currentMode] || '';
  const effortIns = EFFORT_INSTRUCTIONS[_currentEffort] || '';
  if (!modeIns && !effortIns) return message;
  const parts: string[] = [];
  if (modeIns) parts.push(modeIns);
  if (effortIns) parts.push(effortIns);
  return parts.join('\n') + '\n\n' + message;
}

// ═══════════════════════════════════════════════════════════════════
//  Attachments — 引用文件/文件夹/代码片段
// ═══════════════════════════════════════════════════════════════════

let _pendingAttachments: ChatAttachment[] = [];
let _attachIdCounter = 0;

function addAttachment(att: Omit<ChatAttachment, 'id'>): void {
  const id = 'att-' + Date.now().toString(36) + '-' + (++_attachIdCounter);
  _pendingAttachments.push({ ...att, id });
  renderAttachments();
}

function removeAttachment(id: string): void {
  _pendingAttachments = _pendingAttachments.filter(a => a.id !== id);
  renderAttachments();
}

function clearAttachments(): void {
  _pendingAttachments = [];
  renderAttachments();
}

function renderAttachments(): void {
  const bar = $('fi-attach-bar') as HTMLElement | null;
  if (!bar) return;
  if (_pendingAttachments.length === 0) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }
  bar.style.display = 'flex';
  bar.innerHTML = _pendingAttachments.map(a => {
    let info = '';
    if (a.kind === 'folder') {
      info = a.fileCount ? ` · ${a.fileCount} 文件` : '';
    } else if (a.kind === 'clip') {
      info = ` · ${a.startLine}-${a.endLine}`;
    }
    const iconHtml = ExplorerService.iconFor(a.name, a.kind === 'folder');
    return `<div class="fi-attach-pill" data-attach-id="${a.id}" data-kind="${a.kind}" title="${E(a.path)}">
      ${iconHtml}
      <span class="fi-attach-pill-name">${E(a.name)}</span>
      <span class="fi-attach-pill-info">${info}</span>
      <button class="fi-attach-del" onclick="event.stopPropagation();App.Chat.removeAttachment('${a.id}')">✕</button>
    </div>`;
  }).join('');
  // Click on pill → open file / jump to line
  bar.querySelectorAll('.fi-attach-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.fi-attach-del')) return;
      const id = (pill as HTMLElement).dataset.attachId || '';
      const att = _pendingAttachments.find(a => a.id === id);
      if (!att) return;
      if (att.kind === 'clip' && att.startLine != null) {
        // Open file and jump to line
        const ws = ExplorerService.getWorkspacePath();
        if (!ws) return;
        fetch(`/api/file/read?root=${encodeURIComponent(ws)}&path=${encodeURIComponent(att.path)}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (!d) return;
            const content = d.encoding === 'base64' ? '[二进制文件，无法预览]' : d.content;
            openFileTab(att.path, content, att.path.split('.').pop() || '');
            // Scroll to line after editor loads
            setTimeout(() => {
              const monaco = (window as any).__monaco;
              if (monaco?.editor) {
                monaco.editor.revealLineInCenter(att.startLine!);
                monaco.editor.setPosition({ lineNumber: att.startLine!, column: 1 });
              }
            }, 200);
          });
      } else {
        // Open file tab
        const ws = ExplorerService.getWorkspacePath();
        if (!ws) return;
        fetch(`/api/file/read?root=${encodeURIComponent(ws)}&path=${encodeURIComponent(att.path)}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (!d) return;
            const content = d.encoding === 'base64' ? '[二进制文件，无法预览]' : d.content;
            openFileTab(att.path, content, att.path.split('.').pop() || '');
          });
      }
    });
  });
}

// ─── Drop zone visibility ─────────────────────────────

function showDropZone(show: boolean): void {
  const dz = $('fi-drop-zone');
  if (dz) dz.classList.toggle('show', show);
  const fa = $('fi');
  if (fa) fa.classList.toggle('drag-over', show);
}

// ═══════════════════════════════════════════════════════════════════
//  Send / Stop — 消息发送 & SSE 流
// ═══════════════════════════════════════════════════════════════════

function bind(): void {
  const ci = $('ci') as HTMLTextAreaElement | null, cs = $('cs') as HTMLButtonElement | null;
  if (!ci || !cs) return;

  ci.addEventListener('input', () => {
    ci.style.height = 'auto';
    ci.style.height = Math.min(ci.scrollHeight, 120) + 'px';
    // Slash command popup
    handleSlash(ci);
  });

  let _streamGen = 0;

  function sendOrStop(): void {
    const ci2 = ci!;
    const st = window.__state;
    if (st.IL) {
      if (st.CS) { st.CS.onmessage = null; st.CS.onerror = null; st.CS.close(); st.CS = null; }
      const last = st.M[st.M.length - 1];
      if (last?.streaming) last.streaming = false;
      st.IL = false; updateUI(); sb('ms');
      return;
    }
    const ciVal = ci2.value.trim();
    if (!ciVal) return;
    ci2.value = '';
    ci2.style.height = 'auto';
    st.M.push({ role: 'user', content: ciVal }); st.IL = true;
    st.M.push({ role: 'assistant', content: '', streaming: true });
    updateUI(); sb('ms');
    const _ws = localStorage.getItem('workspace_path') || '';
    const gen = ++_streamGen;

    // 1. 先建立 SSE
    if (st.CS) { st.CS.onmessage = null; st.CS.onerror = null; st.CS.close(); st.CS = null; }
    st.CS = new EventSource('/api/chat/stream');
    st.CS.onmessage = (e: MessageEvent) => {
      if (_streamGen !== gen) return; // 旧流回调直接丢弃
      try {
        const d = JSON.parse(e.data) as { type: string; text?: string; thinking?: boolean };
        const last = st.M[st.M.length - 1];
        if (d.type === 'delta') {
          if (d.thinking) { sb('ms'); return; }
          if (last?.streaming) appendDelta(d.text || '');
          else { st.M.push({ role: 'assistant', content: d.text || '', streaming: true }); updateUI(); }
          sb('ms');
        } else if (d.type === 'done') {
          if (last) { last.content = d.text || ''; last.streaming = false; }
          st.IL = false; st.CS?.close(); st.CS = null;
          const _cs = $('cs') as HTMLButtonElement | null;
          const _ci = $('ci') as HTMLTextAreaElement | null;
          if (_cs) { _cs.disabled = false; _cs.title = '发送消息'; _cs.innerHTML = window.S('iup', 16); }
          if (_ci) _ci.disabled = false;
          const msgsEl = $('ms');
          if (msgsEl) { const md = msgsEl.querySelectorAll('.m'), lm = md[md.length - 1]; if (lm) { lm.classList.remove('go'); const ty = lm.querySelector('.ty'); if (ty) ty.remove(); } }
          sb('ms');
        }
      } catch { /* ignore */ }
    };
    st.CS.onerror = () => {
      if (_streamGen !== gen) return;
      const last = st.M[st.M.length - 1];
      if (last?.streaming) { last.streaming = false; st.IL = false; }
      if (st.CS) { toast('连接中断，请重试', 'error'); st.CS?.close(); st.CS = null; updateUI(); }
    };

    // 2. 再发消息（附带引用文件）
    const atts = _pendingAttachments.length > 0 ? _pendingAttachments : undefined;
    const finalMsg = buildInstruction(ciVal);
    const body = atts ? { message: finalMsg, workspace: _ws, attachments: atts } : { message: finalMsg, workspace: _ws };
    fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(() => { if (atts) clearAttachments(); })
      .catch(() => { if (_streamGen === gen) { window.__state.IL = false; updateUI(); toast('发送失败，请检查网络连接', 'error'); } });
  }

  ci.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOrStop(); }
    if (e.key === 'Escape') { const se = $('fi-slash'); if (se) se.style.display = 'none'; }
    // Tab to complete first slash command
    if (e.key === 'Tab' && ci.value.startsWith('/')) {
      e.preventDefault();
      const slashEl = $('fi-slash');
      if (slashEl && slashEl.style.display !== 'none') {
        const first = slashEl.querySelector('.fi-slash-item') as HTMLElement | null;
        if (first) first.click();
      }
    }
  });
  cs.addEventListener('click', sendOrStop);

  // ─── Wire up model button ───
  const modelBtn = $('fi-model-btn');
  if (modelBtn) {
    modelBtn.onclick = (e) => {
      const st = window.__state.D;
      if (!st || st.modelId === 'N/A' || st.modelId === 'unknown') {
        (window as any).openSettingsModal?.();
      } else {
        showModelPicker(e);
      }
    };
    updateModelName();
  }

  // ─── Wire up mode button ───
  loadModeState();
  const modeBtn = $('fi-mode-btn');
  if (modeBtn) {
    modeBtn.onclick = () => showModePopup(modeBtn);
  }

  // ─── Wire up file attach + button ───
  const fileBtn = $('fi-file-btn');
  if (fileBtn) {
    fileBtn.onclick = async () => {
      const api = (window as any).electronAPI as ElectronAPI | undefined;
      if (api?.openFile) {
        const p = await api.openFile();
        if (p) {
          const ws = ExplorerService.getWorkspacePath();
          const relPath = ws ? p.replace(ws.replace(/\\/g, '/'), '').replace(/^\/+/, '') : p;
          const name = p.split(/[/\\]/).pop() || p;
          addAttachment({ kind: 'file', path: relPath, name });
        }
      } else {
        toast('请使用 Electron 桌面版', 'info');
      }
    };
  }

  // ─── Drag & Drop from explorer tree ───
  const fiArea = $('fi');
  if (fiArea) {
    fiArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      showDropZone(true);
    });
    fiArea.addEventListener('dragleave', (e) => {
      if (!fiArea.contains(e.relatedTarget as Node)) {
        showDropZone(false);
      }
    });
    fiArea.addEventListener('drop', (e) => {
      e.preventDefault();
      showDropZone(false);
      // Try custom MIME first, then text/plain fallback
      let treeNodeId = e.dataTransfer?.getData('text/tree-node');
      if (!treeNodeId) {
        const plain = e.dataTransfer?.getData('text/plain') || '';
        if (plain.startsWith('tree-node:')) treeNodeId = plain.slice(10);
      }
      if (treeNodeId) {
        // Dragged from explorer tree
        const ws = ExplorerService.getWorkspacePath();
        if (!ws) { toast('请先选择工作区', 'error'); return; }
        const name = treeNodeId.split('/').pop() || treeNodeId;
        const tree = (ExplorerService as any)._getTree?.();
        const node = tree?._findNodeById?.(treeNodeId);
        if (node?.isDir) {
          addAttachment({ kind: 'folder', path: treeNodeId, name: name + '/' });
        } else {
          addAttachment({ kind: 'file', path: treeNodeId, name });
        }
        toast(`已添加: ${name}`, 'success');
      } else if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        toast('请使用文件菜单或目录树添加文件', 'info');
      }
    });
  }
  const slashEl = $('fi-slash');
  if (slashEl) {
    slashEl.querySelectorAll('.fi-slash-item').forEach(item => {
      item.addEventListener('click', () => {
        const cmd = (item as HTMLElement).dataset.cmd || '';
        ci.value = cmd + ' ';
        ci.focus();
        slashEl.style.display = 'none';
        ci.style.height = 'auto';
      });
    });
  }

  // ─── Token polling (every 6s) ───
  pollTokenUsage();
  setInterval(pollTokenUsage, 6000);
}

function updateModelName(): void {
  const mn = $('fi-model-name');
  if (!mn) return;
  const st = window.__state.D;
  if (!st || st.modelId === 'N/A' || !st.modelId) {
    mn.textContent = '未配置';
    mn.style.color = 'var(--tm)';
  } else {
    mn.textContent = st.modelId;
    mn.style.color = '';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  UI Sync
// ═══════════════════════════════════════════════════════════════════

function updateUI(): void {
  const ci = $('ci') as HTMLTextAreaElement | null, cs = $('cs') as HTMLButtonElement | null;
  const stIL = window.__state.IL;
  if (ci) ci.disabled = stIL;
  if (cs) {
    cs.disabled = stIL ? false : !ci?.value.trim();
    cs.title = stIL ? '中止' : '发送消息';
    cs.innerHTML = stIL ? window.S('ipause', 16) : window.S('iup', 16);
  }
  $('ms')!.innerHTML = msgs();
}

// ═══════════════════════════════════════════════════════════════════
//  模型选择弹出 (仪表盘面板内点击切换)
// ═══════════════════════════════════════════════════════════════════

function showModelPicker(e: MouseEvent): void {
  const existing = $('model-picker');
  if (existing) { existing.remove(); return; }
  // Save ref before async (e.currentTarget gets recycled after event loop)
  const target = e.currentTarget as HTMLElement || $('fi-model-btn');
  fetch('/api/models').then(r => r.json()).then((data: { models?: Array<{ provider: string; id: string }> }) => {
    if (!data.models || !data.models.length) { toast('没有可用模型'); return; }
    const rect = target.getBoundingClientRect();
    const picker = document.createElement('div');
    picker.id = 'model-picker';
    picker.style.cssText = `position:fixed;bottom:${window.innerHeight - rect.top + 4}px;left:${rect.left}px;z-index:999;background:var(--be);border:1px solid var(--bd);border-radius:8px;padding:4px;max-height:200px;overflow-y:auto;min-width:200px;box-shadow:0 8px 32px rgba(0,0,0,.5)`;
    const grouped: Record<string, Array<{ provider: string; id: string }>> = {};
    for (const m of data.models) {
      if (!grouped[m.provider]) grouped[m.provider] = [];
      grouped[m.provider].push(m);
    }
    for (const [provider, models] of Object.entries(grouped)) {
      const header = document.createElement('div');
      header.style.cssText = 'font-size:.6rem;font-weight:600;text-transform:uppercase;color:var(--tm);padding:6px 10px 3px;letter-spacing:.05em;font-family:var(--fd)';
      header.textContent = provider;
      picker.appendChild(header);
      for (const m of models) {
        const item = document.createElement('div');
        const stD = window.__state.D;
        const active = (m.provider === stD?.modelProvider && m.id === stD?.modelId);
        item.style.cssText = `padding:6px 10px;border-radius:4px;cursor:pointer;font-size:.78rem;font-family:var(--fm);color:${active?'var(--am)':'var(--ts)'};background:${active?'rgba(245,158,11,.1)':'transparent'}`;
        item.textContent = m.id;
        item.onmouseenter = () => { item.style.background = 'var(--bc)'; };
        item.onmouseleave = () => { item.style.background = active ? 'rgba(245,158,11,.1)' : 'transparent'; };
        item.onclick = () => {
          fetch('/api/model/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, modelId: m.id }) })
            .then(r => r.json()).then((r: { ok: boolean; error?: string }) => {
              if (r.ok) { toast('已切换: ' + m.id, 'success'); getD(); picker.remove(); }
              else toast('切换失败: ' + (r.error || ''), 'error');
            }).catch(() => toast('切换失败', 'error'));
        };
        picker.appendChild(item);
      }
    }
    document.body.appendChild(picker);
    const close = function (ev: MouseEvent) { if (!picker.contains(ev.target as Node) && ev.target !== target) { picker.remove(); document.removeEventListener('click', close, true); } };
    setTimeout(() => document.addEventListener('click', close as any, true), 0);
  }).catch((err) => { console.error("[model picker]", err); toast("加载模型列表失败"); });
}

// 公开 API
window.msgs = msgs;
window.bind = bind;
window.updateUI = updateUI;
window.showModelPicker = showModelPicker;

// ─── App 命名空间绑定 ──────────────────────────────────────
const AppChat = (window as any).App?.Chat;
if (AppChat) {
  AppChat.msgs = msgs;
  AppChat.bind = bind;
  AppChat.updateUI = updateUI;
  AppChat.showModelPicker = showModelPicker;
  AppChat.appendDelta = appendDelta;
  AppChat.updateModelName = updateModelName;
  AppChat.addAttachment = addAttachment;
  AppChat.removeAttachment = removeAttachment;
  AppChat.clearAttachments = clearAttachments;
  AppChat.getPendingAttachments = () => _pendingAttachments;
  AppChat.setMode = setMode;
  AppChat.setEffort = setEffort;
  AppChat.getMode = () => _currentMode;
  AppChat.getEffort = () => _currentEffort;
}
