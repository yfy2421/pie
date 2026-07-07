// ═══════════════════════════════════════════════════════════════════
//  消息渲染 & 流式追加
// ═══════════════════════════════════════════════════════════════════

function msgs(): string {
  const M = window.__state.M;
  if (M.length === 0) return '<div class="wl"><h2>Pi — 你的代码助手</h2><p>在下方输入，开始编码</p></div>';
  return M.map(m => {
    const c = m.role + (m.streaming ? ' go' : ''), lb = m.role === 'user' ? '你' : 'Pi';
    const ty = m.streaming ? `<div class="ty"><span class="ty-d"></span><span class="ty-d"></span><span class="ty-d"></span></div>` : '';
    return `<div class="m ${c}"><div class="ml">${lb}</div><div class="mt">${E(m.content||'')}</div>${ty}</div>`;
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
    if (cd) { cd.textContent = last.content; return; }
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
          if (_cs) { _cs.disabled = false; _cs.title = '发送消息'; _cs.innerHTML = window.S('iz', 16); }
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

    // 2. 再发消息
    fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: ciVal, workspace: _ws }) })
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

  // ─── Wire up file attach ───
  const fileBtn = $('fi-file-btn');
  if (fileBtn) { fileBtn.onclick = () => toast('引用文件功能开发中', 'info'); }

  // ─── Wire up slash items ───
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
    cs.innerHTML = stIL ? '停止' : window.S('iz', 16);
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
}
