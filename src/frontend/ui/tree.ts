// Tree widget -- 可复用树控件（参考 VSCode abstractTree.ts）
// 用法: const tree = new Tree(container, { indent: 16 });
//       tree.setData(items); // 渲染顶层
//       tree.setChildren(id, children) // 加载子节点

interface TreeNode {
  id: string;
  label: string;
  icon: string;
  isDir: boolean;
  children?: TreeNode[];
}

interface TreeOptions {
  indent?: number;
}

class Tree {
  private el: HTMLDivElement;
  private _expanded = new Set<string>();
  private _selected = "";
  private _data: TreeNode[] = [];
  private _childCache = new Map<string, TreeNode[]>();
  private _indent: number;
  private _onSelect: ((node: TreeNode) => void) | null = null;
  /** 每个节点的 fetch 代数 — 防止异步回调过期导致重复渲染 */
  private _fetchGen = new Map<string, number>();
  /** 键盘输入查找缓冲 */
  private _searchBuf = "";
  private _searchTimer: any = null;

  private _ctxMenu: HTMLDivElement | null = null;
  private _ctxNode: TreeNode | null = null;
  private _stateKey = 'explorer-state';
  private _loadQueued = false;

  constructor(container: HTMLElement, opts: TreeOptions = {}) {
    this._indent = opts.indent || 14;
    this.el = document.createElement('div');
    this.el.className = 'explorer-tree';
    this.el.tabIndex = 0;
    this.el.addEventListener('keydown', (e) => this._onKeyDown(e));
    this.el.addEventListener('contextmenu', (e) => this._onContextMenu(e));
    this.el.addEventListener('dragover', (e) => this._onDragOver(e));
    this.el.addEventListener('dragleave', (e) => this._onDragLeave(e));
    this.el.addEventListener('drop', (e) => this._onDrop(e));
    container.appendChild(this.el);
  }

  set onSelect(fn: ((node: TreeNode) => void) | null) { this._onSelect = fn; }

  setData(data: TreeNode[]): void {
    this._data = data;
    // 首次加载时从 localStorage 恢复展开状态
    if (!this._loadQueued) {
      this._loadQueued = true;
      try {
        const raw = localStorage.getItem(this._stateKey);
        if (!raw) { this._loadQueued = false; this.render(); return; }
        const s = JSON.parse(raw);
        const toExpand: string[] = s.expanded || [];
        // 恢复选中的节点
        if (s.selected) this._selected = s.selected;
        this.render(); // 先渲染骨架
        // 逐级展开恢复的节点（触发 _onExpand 加载子节点）
        const expandNext = (ids: string[]) => {
          if (!ids.length) { this._loadQueued = false; return; }
          const id = ids.shift()!;
          this._expanded.add(id);
          const node = this._findNodeById(id);
          if (!node || !node.isDir) { expandNext(ids); return; }
          const cached = this._childCache.get(id);
          if (cached) {
            // 已有缓存：直接渲染然后展开下一个
            this.render();
            expandNext(ids);
          } else {
            // 无缓存：触发加载，拿到结果后渲染并继续
            this._onExpand?.(node, (children) => {
              this._childCache.set(id, children || []);
              if (!this._expanded.has(id)) { expandNext(ids); return; }
              this.render();
              expandNext(ids);
            });
          }
        };
        expandNext(toExpand);
      } catch {
        this._loadQueued = false;
        this.render();
      }
    } else {
      this.render();
    }
  }

  setChildren(parentId: string, children: TreeNode[]): void {
    this._childCache.set(parentId, children);
    this._expanded.add(parentId);
    this.render();
  }

  private render(): void {
    this.el.innerHTML = '';
    this.renderNodes(this._data, 0, []);
  }

  /** 渲染节点列表。 */
  private renderNodes(nodes: TreeNode[], depth: number, pg: boolean[], insertAfter?: HTMLElement): void {
    const folders = nodes.filter(n => n.isDir);
    const guideAtDepth = folders.length > 1 && folders.some(n => this._expanded.has(n.id));

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const guides = [...pg, guideAtDepth];
      const row = this.buildRow(n, depth, guides);

      if (insertAfter) {
        insertAfter.parentNode!.insertBefore(row, insertAfter.nextSibling);
      } else {
        this.el.appendChild(row);
      }
      insertAfter = row;

      if (n.isDir && this._expanded.has(n.id)) {
        const cc = this._childCache.get(n.id);
        if (cc && cc.length > 0) {
          this.renderNodes(cc, depth + 1, guides, row);
          insertAfter = this.el.lastElementChild as HTMLElement || row;
        } else if (cc) {
          insertAfter = row;
        }
      }

      row.onclick = (e) => { e.stopPropagation(); this.onRowClick(n); };
    }
  }

  private buildRow(n: TreeNode, depth: number, guides: boolean[]): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'exp-row' + (n.id === this._selected ? ' active' : '');
    row.dataset.id = n.id;
    row.dataset.depth = String(depth);
    row.draggable = true;
    row.style.paddingLeft = (2 + depth * 14) + 'px';
    row.addEventListener('dragstart', (e: DragEvent) => {
      e.dataTransfer?.setData('text/tree-node', n.id);
      e.dataTransfer?.setData('text/plain', 'tree-node:' + n.id);
      e.dataTransfer!.effectAllowed = 'move';
    });

    let html = '';
    for (let d = 0; d < depth; d++) {
      html += '<span class="indent-guide"></span>';
    }

    const drawOwnLine = n.isDir && guides[depth];
    const tw = n.isDir
      ? `<span class="exp-twistie${this._expanded.has(n.id) ? ' open' : ''}${drawOwnLine ? ' draw-line' : ''}"></span>`
      : `<span class="exp-twistie hidden"></span>`;

    row.innerHTML = `<span class="exp-indent">${html}</span>${tw}${n.icon}<span class="exp-name">${E(n.label)}</span>`;
    return row;
  }

  private onRowClick(n: TreeNode): void {
    this._selectAndActivate(n);
  }

  /** 选中并激活（展开或打开） */
  private _saveState(): void {
    try {
      localStorage.setItem(this._stateKey, JSON.stringify({
        expanded: Array.from(this._expanded),
        selected: this._selected,
      }));
    } catch {}
  }

  private _selectAndActivate(n: TreeNode): void {
    this._selected = n.id;
    this._saveState();
    if (!n.isDir) {
      this._onSelect?.(n);
      this.render();
      this.el.focus();
      return;
    }
    if (this._expanded.has(n.id)) {
      this._expanded.delete(n.id);
      this._saveState();
      this.render();
      this.el.focus();
      return;
    } else {
      const gen = (this._fetchGen.get(n.id) || 0) + 1;
      this._fetchGen.set(n.id, gen);
      this._expanded.add(n.id);
      this._saveState();
      const cached = this._childCache.get(n.id);
      if (cached) {
        this.render();
        this.el.focus();
      } else {
        this._onExpand?.(n, (children) => {
          this._childCache.set(n.id, children || []);
          if (this._fetchGen.get(n.id) !== gen) return;
          if (!this._expanded.has(n.id)) return;
          this.render();
          this.el.focus();
        });
      }
    }
  }

  // ─── 拖放 ────────────────────────────────────────────────
  private _dropTarget: string | null = null;
  private _dragAutoExpand: any = null;

  set onDragMove(cb: ((nodeId: string, targetParentId: string) => void) | null) { this._onDragMove = cb; }
  private _onDragMove: ((nodeId: string, targetParentId: string) => void) | null = null;

  private _onDragOver(e: DragEvent): void {
    e.preventDefault();
    const row = (e.target as HTMLElement).closest('.exp-row') as HTMLElement | null;
    if (!row) { // 空白区域
      this._clearDropTarget();
      return;
    }
    const id = row.dataset.id || '';
    const node = this._findNodeById(id);
    if (!node) return;
    // 只有文件夹可以 drop
    if (!node.isDir) {
      this._clearDropTarget();
      return;
    }
    this._setDropTarget(id, row);
    // 自动展开：悬停 600ms 后展开文件夹
    if (!this._expanded.has(id) && !this._dragAutoExpand) {
      this._dragAutoExpand = setTimeout(() => {
        if (this._dropTarget !== id) { this._dragAutoExpand = null; return; }
        const cc = this._childCache.get(id);
        if (cc) {
          // 已有缓存 → 直接展开
          this._expanded.add(id);
          this.render();
        } else {
          // 无缓存 → 触发加载
          this._expanded.add(id);
          this._onExpand?.(this._findNodeById(id)!, (children) => {
            this._childCache.set(id, children || []);
            if (!this._expanded.has(id)) return;
            this.render();
          });
        }
        this._dragAutoExpand = null;
      }, 600);
    }
    e.dataTransfer!.dropEffect = 'move';
  }

  private _onDragLeave(e: DragEvent): void {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && this.el.contains(related)) return; // 还在树内
    this._clearDropTarget();
  }

  private _onDrop(e: DragEvent): void {
    e.preventDefault();
    clearTimeout(this._dragAutoExpand);
    const dstId = this._dropTarget;    // ← 先存下来
    this._clearDropTarget();            // ← 再清除

    // 外部文件拖入
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      this._handleExternalDrop(e.dataTransfer.files, e.dataTransfer);
      return;
    }
    // 树内拖拽
    const srcId = e.dataTransfer?.getData('text/tree-node');
    if (srcId && dstId && srcId !== dstId && this._onDragMove) {
      this._onDragMove(srcId, dstId);
    }
  }

  private _handleExternalDrop(files: FileList, dt: DataTransfer): void {
    const items = Array.from(files);
    // 调用外部处理（由 pane 注册）
    if (this._onExternalDrop) this._onExternalDrop(items, dt);
  }
  set onExternalDrop(cb: ((files: File[], dt: DataTransfer) => void) | null) { this._onExternalDrop = cb; }
  private _onExternalDrop: ((files: File[], dt: DataTransfer) => void) | null = null;

  private _setDropTarget(id: string, row: HTMLElement): void {
    if (this._dropTarget === id) return;
    this._clearDropTarget();
    this._dropTarget = id;
    row.classList.add('drop-target');
  }

  private _clearDropTarget(): void {
    if (this._dropTarget) {
      const old = this.el.querySelector('.drop-target') as HTMLElement | null;
      old?.classList.remove('drop-target');
    }
    this._dropTarget = null;
    clearTimeout(this._dragAutoExpand);
    this._dragAutoExpand = null;
  }

  // ─── 键盘导航 ─────────────────────────────────────────────

  private _onKeyDown(e: KeyboardEvent): void {
    const rows = this._getRows();
    if (rows.length === 0) return;

    const curIdx = this._selected ? rows.findIndex(r => r.dataset.id === this._selected) : -1;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this._focusRow(rows, Math.min(curIdx + 1, rows.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._focusRow(rows, Math.max(curIdx - 1, 0));
        break;
      case 'ArrowRight':
        e.preventDefault();
        this._expandDir(rows, curIdx);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this._collapseDir(rows, curIdx);
        break;
      case 'Enter':
        e.preventDefault();
        if (curIdx >= 0) this._activateRow(rows[curIdx]);
        break;
      case 'Home':
        e.preventDefault();
        this._focusRow(rows, 0);
        break;
      case 'End':
        e.preventDefault();
        this._focusRow(rows, rows.length - 1);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          this._typeAhead(rows, e.key);
        }
        break;
    }
  }

  private _getRows(): HTMLElement[] {
    return Array.from(this.el.querySelectorAll('.exp-row:not(.exp-empty)')) as HTMLElement[];
  }

  private _focusRow(rows: HTMLElement[], idx: number): void {
    if (idx < 0 || idx >= rows.length) return;
    const id = rows[idx].dataset.id || '';
    // 查找对应的 TreeNode（从 _data 或缓存中）
    const node = this._findNodeById(id);
    if (!node) return;
    this._selected = id;
    this.render();
    // 滚动到可见
    const newRow = this.el.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (newRow) newRow.scrollIntoView({ block: 'nearest' });
    this.el.focus();
  }

  private _expandDir(rows: HTMLElement[], idx: number): void {
    if (idx < 0) return;
    const id = rows[idx].dataset.id || '';
    const node = this._findNodeById(id);
    if (!node?.isDir) return;
    if (!this._expanded.has(id)) {
      // 展开
      this._selectAndActivate(node);
    } else {
      // 已展开 → 移到第一个子节点
      const childRows = this._getRows();
      const curIdx = childRows.findIndex(r => r.dataset.id === id);
      if (curIdx >= 0 && curIdx + 1 < childRows.length) {
        this._focusRow(childRows, curIdx + 1);
      }
    }
  }

  private _collapseDir(rows: HTMLElement[], idx: number): void {
    if (idx < 0) return;
    const id = rows[idx].dataset.id || '';
    const node = this._findNodeById(id);
    if (!node) return;
    if (node.isDir && this._expanded.has(id)) {
      // 收起文件夹
      this._expanded.delete(id);
      this.render();
      this.el.focus();
    } else {
      // 文件或已收起 → 移到父级（找最近上一级行）
      const depth = parseInt(rows[idx].dataset.depth || '0');
      for (let i = idx - 1; i >= 0; i--) {
        const pd = parseInt(rows[i].dataset.depth || '0');
        if (pd < depth) { this._focusRow(rows, i); return; }
      }
    }
  }

  private _activateRow(row: HTMLElement): void {
    const id = row.dataset.id || '';
    const node = this._findNodeById(id);
    if (node) this._selectAndActivate(node);
  }

  /** 查找 TreeNode（从 _data 递归 / _childCache） */
  private _findNodeById(id: string): TreeNode | undefined {
    const search = (nodes: TreeNode[]): TreeNode | undefined => {
      for (const n of nodes) {
        if (n.id === id) return n;
        const cached = this._childCache.get(n.id);
        if (cached) { const found = search(cached); if (found) return found; }
      }
      return undefined;
    };
    return search(this._data);
  }

  /** 输入查找：跳转到第一个匹配文件名的行 */
  private _typeAhead(rows: HTMLElement[], key: string): void {
    this._searchBuf += key.toLowerCase();
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => { this._searchBuf = ''; }, 800);
    for (let i = 0; i < rows.length; i++) {
      const label = rows[i].querySelector('.exp-name')?.textContent || '';
      if (label.toLowerCase().startsWith(this._searchBuf)) {
        this._focusRow(rows, i);
        return;
      }
    }
  }

  // ─── 右键菜单 ─────────────────────────────────────────────

  /** 设置右键菜单项。label: 菜单项文本, action: (node, tree) => void */
  set contextMenu(actions: { label: string; action: (node: TreeNode, tree: Tree) => void; disabled?: (node: TreeNode) => boolean }[]) {
    this._ctxActions = actions;
  }
  /** 空白区域右键（如新建文件/文件夹） */
  set blankContextMenu(actions: { label: string; action: () => void }[]) {
    this._blankCtxActions = actions;
  }

  private _ctxActions: { label: string; action: (node: TreeNode, tree: Tree) => void; disabled?: (node: TreeNode) => boolean }[] = [];
  private _blankCtxActions: { label: string; action: () => void }[] = [];

  private _onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const row = (e.target as HTMLElement).closest('.exp-row') as HTMLElement | null;
    if (!row) {
      // 空白区域 → 显示 blank 菜单
      this._showBlankCtxMenu(e.clientX, e.clientY);
      return;
    }
    const id = row.dataset.id || '';
    const node = this._findNodeById(id);
    if (!node) return;
    this._ctxNode = node;
    this._selected = node.id;
    this.render();
    this._showNodeCtxMenu(e.clientX, e.clientY);
  }

  private _showNodeCtxMenu(x: number, y: number): void {
    this._hideCtxMenu();
    const menu = this._buildMenu(this._ctxActions.map(a => ({
      label: a.label, disabled: a.disabled?.(this._ctxNode!),
      action: () => { this._hideCtxMenu(); a.action(this._ctxNode!, this); },
    })));
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    this._attachMenu(menu);
  }

  private _showBlankCtxMenu(x: number, y: number): void {
    if (!this._blankCtxActions.length) return;
    this._hideCtxMenu();
    const menu = this._buildMenu(this._blankCtxActions.map(a => ({
      label: a.label, disabled: false,
      action: () => { this._hideCtxMenu(); a.action(); },
    })));
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    this._attachMenu(menu);
  }

  private _buildMenu(items: { label: string; disabled: boolean; action: () => void }[]): HTMLDivElement {
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    for (const a of items) {
      if (a.label === '-') {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep'; menu.appendChild(sep);
        continue;
      }
      const item = document.createElement('div');
      item.className = 'ctx-item' + (a.disabled ? ' ctx-disabled' : '');
      item.textContent = a.label;
      if (!a.disabled) item.onclick = a.action;
      menu.appendChild(item);
    }
    return menu;
  }

  private _attachMenu(menu: HTMLDivElement): void {
    this._ctxMenu = menu;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', this._ctxCloseHandler = () => this._hideCtxMenu(), { once: true }), 0);
  }

  private _ctxCloseHandler: (() => void) | null = null;

  private _hideCtxMenu(): void {
    if (this._ctxMenu) { this._ctxMenu.remove(); this._ctxMenu = null; }
    if (this._ctxCloseHandler) { document.removeEventListener('click', this._ctxCloseHandler); this._ctxCloseHandler = null; }
  }

  private _onExpand: ((node: TreeNode, cb: (children?: TreeNode[]) => void) => void) | null = null;
  /** 行内新建（VS Code 风格）：在 parent 下创建临时行并进入编辑 */
  inlineCreate(parentId: string, isDir: boolean, onCreate: (name: string) => void): void {
    const isRoot = parentId === '';
    if (!isRoot && !this._childCache.has(parentId)) {
      // 尝试加载该目录
      this._onExpand?.(this._findNodeById(parentId)!, (children) => {
        this._childCache.set(parentId, children || []);
        this._expanded.add(parentId);
        this.inlineCreate(parentId, isDir, onCreate);
      });
      return;
    }
    const tempId = isRoot ? '__new__' : parentId + '/__new__';
    const tempNode: TreeNode = { id: tempId, label: '', icon: '', isDir: false };
    if (isRoot) {
      this._data.unshift(tempNode);
    } else {
      const children = this._childCache.get(parentId) || [];
      children.unshift(tempNode);
      this._childCache.set(parentId, children);
      this._expanded.add(parentId);
    }
    this.render();

    const cleanup = () => {
      if (isRoot) {
        const idx = this._data.findIndex(c => c.id === tempId);
        if (idx >= 0) this._data.splice(idx, 1);
      } else {
        const cc = this._childCache.get(parentId) || [];
        const idx = cc.findIndex(c => c.id === tempId);
        if (idx >= 0) cc.splice(idx, 1);
        this._childCache.set(parentId, cc);
      }
    };
    requestAnimationFrame(() => {
      this.inlineRename(tempId, (name) => { cleanup(); if (name) onCreate(name); else this.render(); },
        () => { cleanup(); this.render(); });
    });
  }

  /** 行内编辑（VS Code 风格）：替换指定节点的标签为 input */
  private _editingNode: TreeNode | null = null;
  inlineRename(id: string, cb: (newName: string) => void, onCancel?: () => void): void {
    const row = this.el.querySelector(`[data-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (!row) return;
    const node = this._findNodeById(id);
    if (!node) return;
    this._editingNode = node;

    const nameEl = row.querySelector('.exp-name') as HTMLElement | null;
    if (!nameEl) return;
    const oldName = nameEl.textContent || '';
    const input = document.createElement('input');
    input.type = 'text'; input.value = oldName;
    input.className = 'sess-rename-input';
    input.style.cssText = 'width:100%;padding:1px 4px;border-radius:3px;border:1px solid var(--am);background:var(--bc);color:var(--tx);font-size:13px;font-family:var(--fm);outline:none;box-sizing:border-box';
    nameEl.innerHTML = '';
    nameEl.appendChild(input);
    input.focus();
    // 光标放到末尾
    input.setSelectionRange(input.value.length, input.value.length);

    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const val = input.value.trim();
      if (save && val && val !== oldName) cb(val);
      else if (!save && onCancel) onCancel();
      else nameEl.textContent = save && val ? val : oldName;
      this._editingNode = null;
    };
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      e.stopPropagation(); // 阻止冒泡到树的 keydown 处理
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    // 点击输入框外部 = 取消
    setTimeout(() => {
      const h = (ce: MouseEvent) => {
        if (!document.contains(input)) return document.removeEventListener('mousedown', h);
        if (!input.contains(ce.target as Node)) finish(false);
      };
      document.addEventListener('mousedown', h);
    }, 0);
  }

  /** 清空子节点缓存，强制下次展开时重新获取 */
  clearChildCache(): void {
    this._childCache.clear();
  }

  set onExpand(fn: ((node: TreeNode, cb: (children?: TreeNode[]) => void) => void) | null) { this._onExpand = fn; }

  expandAll(paths: string[]): void {
    for (const p of paths) this._expanded.add(p);
    this.render();
  }
}
