/* ------------------------------------------------------------------ *
 *  Command registry.                                                   *
 *                                                                      *
 *  Every action in the app lives here once, and the toolbar, menus,     *
 *  right-click menu, command palette and keyboard shortcuts are all     *
 *  generated from it. Add a command, get all five for free.             *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const U = IK.util;
  const M = IK.model;
  const G = IK.geom;
  const store = IK.store;
  const R = IK.render;
  const X = IK.exporters;
  const L = IK.license;
  const P = IK.platform;
  const st = store.state;

  const C = { list: [], map: {} };

  function def(cmd) {
    C.list.push(cmd);
    C.map[cmd.id] = cmd;
    return cmd;
  }

  C.run = function (id, arg) {
    const cmd = C.map[id];
    if (!cmd) return false;
    if (cmd.when && !cmd.when()) return false;
    if (cmd.pro && !L.require(cmd.pro)) return false;
    cmd.run(arg);
    return true;
  };

  C.get = (id) => C.map[id];
  C.exists = (id) => !!C.map[id];

  const hasSelection = () => st.selection.length > 0;
  const ask = (event, payload) => store.emit(event, payload || {});

  /* ------------------------------------------------------------------ */
  /*  File                                                               */
  /* ------------------------------------------------------------------ */

  def({ id: 'file.new', title: 'New board', group: 'File', icon: 'file', accel: 'Mod+N',
    run: () => ask('request:new') });

  def({ id: 'file.templates', title: 'New from template…', group: 'File', icon: 'template', accel: 'Mod+Shift+N',
    run: () => ask('ui:templates') });

  def({ id: 'file.open', title: 'Open board…', group: 'File', icon: 'open', accel: 'Mod+O',
    run: () => ask('request:open') });

  def({ id: 'file.save', title: 'Save', group: 'File', icon: 'save', accel: 'Mod+S',
    run: () => ask('request:save', { as: false }) });

  def({ id: 'file.saveAs', title: 'Save as…', group: 'File', icon: 'save', accel: 'Mod+Shift+S',
    run: () => ask('request:save', { as: true }) });

  def({ id: 'file.import', title: 'Import image…', group: 'File', icon: 'image',
    run: () => ask('request:importImage') });

  def({ id: 'file.exportPanel', title: 'Export…', group: 'File', icon: 'export', accel: 'Mod+E',
    run: () => ask('ui:export') });

  def({ id: 'export.png', title: 'Export PNG', group: 'File', icon: 'download',
    run: (opts) => ask('request:export', Object.assign({ format: 'png' }, opts)) });

  def({ id: 'export.svg', title: 'Export SVG', group: 'File', icon: 'download', pro: 'export.svg',
    run: (opts) => ask('request:export', Object.assign({ format: 'svg' }, opts)) });

  def({ id: 'export.pdf', title: 'Export PDF', group: 'File', icon: 'download', pro: 'export.pdf',
    run: (opts) => ask('request:export', Object.assign({ format: 'pdf' }, opts)) });

  def({ id: 'export.clipboard', title: 'Copy board as image', group: 'File', icon: 'copy', accel: 'Mod+Shift+C',
    run: async () => {
      const blob = await X.toBlob({ scale: 2, selectionOnly: hasSelection() });
      const ok = await P.writeClipboardImage(blob);
      U.toast(ok ? 'Image copied to clipboard' : 'Clipboard blocked — use Export instead');
    } });

  def({ id: 'file.print', title: 'Print…', group: 'File', icon: 'printer', accel: 'Mod+P',
    run: () => ask('request:print') });

  def({ id: 'file.backups', title: 'Board history…', group: 'File', icon: 'history', pro: 'history',
    run: () => ask('ui:backups') });

  /* ------------------------------------------------------------------ */
  /*  Edit                                                               */
  /* ------------------------------------------------------------------ */

  def({ id: 'edit.undo', title: 'Undo', group: 'Edit', icon: 'undo', accel: 'Mod+Z',
    when: () => store.canUndo(), run: () => store.undo() });

  def({ id: 'edit.redo', title: 'Redo', group: 'Edit', icon: 'redo', accel: 'Mod+Shift+Z',
    when: () => store.canRedo(), run: () => store.redo() });

  def({ id: 'edit.cut', title: 'Cut', group: 'Edit', icon: 'copy', accel: 'Mod+X',
    when: hasSelection, run: () => X.copySelection(true) });

  def({ id: 'edit.copy', title: 'Copy', group: 'Edit', icon: 'copy', accel: 'Mod+C',
    when: hasSelection, run: () => X.copySelection(false) });

  def({ id: 'edit.paste', title: 'Paste', group: 'Edit', icon: 'copy', accel: 'Mod+V',
    run: async () => {
      const at = IK.ui && IK.ui.lastPointer;
      // Prefer our own elements, then an image, then plain text.
      const text = await P.readClipboardText();
      if (text && text.indexOf('inkora/clipboard:') === 0) return X.pasteText(text, at);
      const blob = P.readClipboardImage ? await P.readClipboardImage() : null;
      if (blob) return IK.tools.insertImageFile(blob, at && at.x, at && at.y);
      X.pasteText(text || X._localClipboard, at);
    } });

  def({ id: 'edit.duplicate', title: 'Duplicate', group: 'Edit', icon: 'duplicate', accel: 'Mod+D',
    when: hasSelection, run: () => X.duplicateSelection() });

  def({ id: 'edit.delete', title: 'Delete', group: 'Edit', icon: 'trash', accel: 'Delete',
    when: hasSelection, run: () => store.remove(st.selection.slice()) });

  def({ id: 'edit.selectAll', title: 'Select all', group: 'Edit', icon: 'select', accel: 'Mod+A',
    run: () => store.selectAll() });

  def({ id: 'edit.selectSame', title: 'Select all of this kind', group: 'Edit', icon: 'select',
    when: hasSelection,
    run: () => {
      const kinds = new Set(store.selected().map((e) => e.type));
      store.setSelection(store.elements().filter((e) => kinds.has(e.type) && !e.locked).map((e) => e.id), { raw: true });
    } });

  def({ id: 'edit.group', title: 'Group', group: 'Arrange', icon: 'group', accel: 'Mod+G',
    when: () => st.selection.length > 1, run: () => store.group() });

  def({ id: 'edit.ungroup', title: 'Ungroup', group: 'Arrange', icon: 'ungroup', accel: 'Mod+Shift+G',
    when: () => store.selected().some((e) => e.groupId), run: () => store.ungroup() });

  def({ id: 'edit.lock', title: 'Lock', group: 'Arrange', icon: 'lock', accel: 'Mod+Shift+L',
    when: hasSelection,
    run: () => {
      const ids = st.selection.slice();
      store.mutate(() => ids.forEach((id) => { const el = store.byId(id); if (el) el.locked = true; }), 'lock');
      store.clearSelection();
      // A locked element cannot be clicked, so the way back has to be handed
      // over at the moment of locking, not left to be discovered.
      U.toast(ids.length > 1 ? ids.length + ' items locked' : 'Locked', {
        duration: 7000,
        action: {
          label: 'Undo',
          run: () => {
            store.mutate(() => ids.forEach((id) => {
              const el = store.byId(id);
              if (el) el.locked = false;
            }), 'unlock');
            store.setSelection(ids);
          }
        }
      });
    } });

  def({ id: 'edit.unlockAll', title: 'Unlock everything', group: 'Arrange', icon: 'unlock',
    when: () => store.elements().some((e) => e.locked),
    run: () => store.mutate(() => store.elements().forEach((el) => { el.locked = false; }), 'unlock') });

  def({ id: 'edit.hide', title: 'Hide', group: 'Arrange', icon: 'eyeOff', when: hasSelection,
    run: () => { store.updateMany(st.selection.slice(), { hidden: true }); store.clearSelection(); } });

  def({ id: 'edit.showAll', title: 'Show hidden elements', group: 'Arrange', icon: 'eye',
    when: () => store.elements().some((e) => e.hidden),
    run: () => store.mutate(() => store.elements().forEach((el) => { el.hidden = false; }), 'show') });

  /* ---- z-order ------------------------------------------------------ */

  def({ id: 'order.front', title: 'Bring to front', group: 'Arrange', icon: 'front', accel: 'Mod+Shift+]',
    when: hasSelection, run: () => store.reorder(st.selection.slice(), 'front') });
  def({ id: 'order.forward', title: 'Bring forward', group: 'Arrange', icon: 'front', accel: 'Mod+]',
    when: hasSelection, run: () => store.reorder(st.selection.slice(), 'forward') });
  def({ id: 'order.backward', title: 'Send backward', group: 'Arrange', icon: 'back', accel: 'Mod+[',
    when: hasSelection, run: () => store.reorder(st.selection.slice(), 'backward') });
  def({ id: 'order.back', title: 'Send to back', group: 'Arrange', icon: 'back', accel: 'Mod+Shift+[',
    when: hasSelection, run: () => store.reorder(st.selection.slice(), 'back') });

  /* ---- align & distribute ------------------------------------------- */

  function alignSelection(mode) {
    const sel = store.selected().filter((e) => !e.locked);
    if (sel.length < 2) return;
    const box = G.aabbOf(sel);
    store.mutate(() => {
      sel.forEach((el) => {
        const b = G.aabb(el);
        if (mode === 'left') el.x += box.x - b.x;
        if (mode === 'right') el.x += (box.x + box.w) - (b.x + b.w);
        if (mode === 'hcenter') el.x += (box.x + box.w / 2) - (b.x + b.w / 2);
        if (mode === 'top') el.y += box.y - b.y;
        if (mode === 'bottom') el.y += (box.y + box.h) - (b.y + b.h);
        if (mode === 'vcenter') el.y += (box.y + box.h / 2) - (b.y + b.h / 2);
      });
    }, 'align');
    store.refreshBindings(sel.map((e) => e.id));
  }

  [['left', 'Align left'], ['hcenter', 'Align centre'], ['right', 'Align right'],
    ['top', 'Align top'], ['vcenter', 'Align middle'], ['bottom', 'Align bottom']].forEach(([mode, title]) => {
    def({ id: 'align.' + mode, title, group: 'Arrange', icon: 'align',
      when: () => st.selection.length > 1, run: () => alignSelection(mode) });
  });

  function distribute(axis) {
    const sel = store.selected().filter((e) => !e.locked);
    if (sel.length < 3) return;
    const key = axis === 'h' ? 'x' : 'y';
    const size = axis === 'h' ? 'w' : 'h';
    const sorted = sel.slice().sort((a, b) => G.aabb(a)[key] - G.aabb(b)[key]);
    const first = G.aabb(sorted[0]);
    const last = G.aabb(sorted[sorted.length - 1]);
    const total = (last[key] + last[size]) - first[key];
    const used = sorted.reduce((sum, el) => sum + G.aabb(el)[size], 0);
    const gap = (total - used) / (sorted.length - 1);
    let cursor = first[key];
    store.mutate(() => {
      sorted.forEach((el) => {
        const b = G.aabb(el);
        el[key] += cursor - b[key];
        cursor += b[size] + gap;
      });
    }, 'distribute');
    store.refreshBindings(sel.map((e) => e.id));
  }

  def({ id: 'align.distributeH', title: 'Distribute horizontally', group: 'Arrange', icon: 'align',
    when: () => st.selection.length > 2, run: () => distribute('h') });
  def({ id: 'align.distributeV', title: 'Distribute vertically', group: 'Arrange', icon: 'align',
    when: () => st.selection.length > 2, run: () => distribute('v') });

  /**
   * Tidy up: lay the selection out in a neat grid, in reading order.
   * Sizes are kept; rows take the height of their tallest item. Connectors
   * are left out of the grid and simply follow their shapes.
   */
  C.tidy = function () {
    const items = store.selected().filter((e) => !e.locked && !M.isLinear(e));
    if (items.length < 2) return;
    const box = G.aabbOf(items);
    const sorted = items.slice().sort((a, b) => {
      const ra = Math.round(G.aabb(a).y / 60), rb = Math.round(G.aabb(b).y / 60);
      return ra - rb || G.aabb(a).x - G.aabb(b).x;
    });
    const cols = Math.ceil(Math.sqrt(sorted.length));
    const gap = 24;
    const colW = [];
    sorted.forEach((el, i) => { const c = i % cols; colW[c] = Math.max(colW[c] || 0, G.aabb(el).w); });
    store.mutate(() => {
      let y = box.y;
      for (let r = 0; r * cols < sorted.length; r++) {
        const row = sorted.slice(r * cols, r * cols + cols);
        let x = box.x;
        let rowH = 0;
        row.forEach((el, c) => {
          const b = G.aabb(el);
          el.x += x - b.x;
          el.y += y - b.y;
          x += colW[c] + gap;
          rowH = Math.max(rowH, b.h);
        });
        y += rowH + gap;
      }
    }, 'tidy');
    store.refreshBindings(items.map((e) => e.id));
    R.request();
  };

  def({ id: 'arrange.tidy', title: 'Tidy up into a grid', group: 'Arrange', icon: 'grid', accel: 'Mod+Shift+A',
    when: () => store.selected().filter((e) => !e.locked && !M.isLinear(e)).length > 1,
    run: () => C.tidy() });

  def({ id: 'edit.flipH', title: 'Flip horizontally', group: 'Arrange', icon: 'flip',
    when: hasSelection,
    run: () => store.mutate(() => store.selected().forEach((el) => G.flip(el, 'h')), 'flip') });
  def({ id: 'edit.flipV', title: 'Flip vertically', group: 'Arrange', icon: 'flip',
    when: hasSelection,
    run: () => store.mutate(() => store.selected().forEach((el) => G.flip(el, 'v')), 'flip') });

  def({ id: 'edit.resetAngle', title: 'Reset rotation', group: 'Arrange', icon: 'rotate',
    when: () => store.selected().some((e) => e.angle),
    run: () => store.updateMany(st.selection.slice(), { angle: 0 }) });

  /* ------------------------------------------------------------------ */
  /*  Tools                                                              */
  /* ------------------------------------------------------------------ */

  const TOOLS = [
    ['select', 'Select', 'select', 'V'],
    ['hand', 'Pan', 'hand', 'H'],
    ['pen', 'Pen', 'pen', 'P'],
    ['marker', 'Highlighter', 'marker', 'M'],
    ['eraser', 'Eraser', 'eraser', 'E'],
    ['line', 'Line', 'line', 'L'],
    ['arrow', 'Arrow', 'arrow', 'A'],
    ['rect', 'Rectangle', 'rect', 'R'],
    ['ellipse', 'Ellipse', 'ellipse', 'O'],
    ['diamond', 'Diamond', 'diamond', 'D'],
    ['triangle', 'Triangle', 'triangle', ''],
    ['star', 'Star', 'star', ''],
    ['hexagon', 'Hexagon', 'hexagon', ''],
    ['cylinder', 'Cylinder', 'cylinder', ''],
    ['cloud', 'Cloud', 'cloud', ''],
    ['bubble', 'Speech bubble', 'bubble', ''],
    ['parallelogram', 'Parallelogram', 'rect', ''],
    ['text', 'Text', 'text', 'T'],
    ['note', 'Sticky note', 'note', 'N'],
    ['frame', 'Frame', 'frame', 'F'],
    ['comment', 'Comment pin', 'comment', 'C'],
    ['laser', 'Laser pointer', 'laser', 'K']
  ];
  C.TOOLS = TOOLS;

  TOOLS.forEach(([id, title, icon, key]) => {
    def({
      id: 'tool.' + id, title: title + ' tool', group: 'Tools', icon, accel: key,
      checked: () => st.tool === id,
      run: () => store.setTool(id)
    });
  });

  def({ id: 'tool.lockToggle', title: 'Keep tool selected after drawing', group: 'Tools', icon: 'lock', accel: 'Q',
    checked: () => st.ui.lockTool,
    run: () => { st.ui.lockTool = !st.ui.lockTool; P.set('lockTool', st.ui.lockTool); store.emit('ui'); } });

  /* ------------------------------------------------------------------ */
  /*  View                                                               */
  /* ------------------------------------------------------------------ */

  def({ id: 'view.zoomIn', title: 'Zoom in', group: 'View', icon: 'zoomIn', accel: 'Mod+=',
    run: () => store.zoomAt(innerWidth / 2, innerHeight / 2, 1.2) });
  def({ id: 'view.zoomOut', title: 'Zoom out', group: 'View', icon: 'zoomOut', accel: 'Mod+-',
    run: () => store.zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.2) });
  def({ id: 'view.zoomReset', title: 'Zoom to 100%', group: 'View', icon: 'fit', accel: 'Mod+0',
    run: () => store.setZoom(1) });
  def({ id: 'view.zoomFit', title: 'Zoom to fit', group: 'View', icon: 'fit', accel: 'Shift+1',
    run: () => store.zoomToFit({ animate: true }) });
  def({ id: 'view.zoomSelection', title: 'Zoom to selection', group: 'View', icon: 'fit', accel: 'Shift+2',
    when: hasSelection, run: () => store.zoomToSelection() });

  def({ id: 'view.theme', title: 'Toggle dark mode', group: 'View', icon: 'moon', accel: 'Mod+Shift+D',
    run: () => {
      const order = ['light', 'dark', 'system'];
      const next = order[(order.indexOf(st.ui.theme) + 1) % order.length];
      ask('ui:theme', { theme: next });
    } });

  def({ id: 'view.background', title: 'Canvas background…', group: 'View', icon: 'grid',
    run: () => ask('ui:background') });

  def({ id: 'view.grid', title: 'Snap to grid', group: 'View', icon: 'grid', accel: 'Mod+\'',
    checked: () => st.ui.gridSnap,
    run: () => { st.ui.gridSnap = !st.ui.gridSnap; P.set('gridSnap', st.ui.gridSnap); store.emit('ui'); R.request(); } });

  def({ id: 'view.snap', title: 'Smart alignment guides', group: 'View', icon: 'magnet',
    checked: () => st.ui.snap,
    run: () => { st.ui.snap = !st.ui.snap; P.set('snap', st.ui.snap); store.emit('ui'); } });

  def({ id: 'view.autoShape', title: 'Snap sketches to clean shapes', group: 'View', icon: 'sparkle',
    checked: () => st.ui.autoShape,
    run: () => { st.ui.autoShape = !st.ui.autoShape; P.set('autoShape', st.ui.autoShape); store.emit('ui'); } });

  def({ id: 'view.minimap', title: 'Minimap', group: 'View', icon: 'map', accel: 'Mod+M',
    checked: () => st.ui.minimap,
    run: () => { st.ui.minimap = !st.ui.minimap; P.set('minimap', st.ui.minimap); store.emit('ui'); } });

  def({ id: 'view.panels', title: 'Hide the interface', group: 'View', icon: 'eyeOff', accel: 'Mod+.',
    checked: () => st.ui.panelsHidden,
    run: () => { st.ui.panelsHidden = !st.ui.panelsHidden; store.emit('ui'); } });

  def({ id: 'view.present', title: 'Start presentation', group: 'View', icon: 'play', accel: 'Shift+P', pro: 'present',
    run: () => ask('request:present') });

  def({ id: 'view.fullscreen', title: 'Full screen', group: 'View', icon: 'fit', accel: 'F11',
    run: () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    } });

  def({ id: 'view.search', title: 'Find on board…', group: 'View', icon: 'search', accel: 'Mod+F',
    run: () => ask('ui:search') });

  /* ------------------------------------------------------------------ */
  /*  Pages                                                              */
  /* ------------------------------------------------------------------ */

  def({ id: 'page.add', title: 'Add page', group: 'Pages', icon: 'plus',
    run: () => {
      if (store.doc().pages.length >= L.LIMITS.freePages && !L.require('pages')) return;
      store.addPage();
    } });
  def({ id: 'page.duplicate', title: 'Duplicate page', group: 'Pages', icon: 'duplicate',
    run: () => {
      if (store.doc().pages.length >= L.LIMITS.freePages && !L.require('pages')) return;
      store.duplicatePage();
    } });
  def({ id: 'page.delete', title: 'Delete page', group: 'Pages', icon: 'trash',
    when: () => store.doc().pages.length > 1,
    run: () => store.removePage(store.doc().activePage) });
  def({ id: 'page.next', title: 'Next page', group: 'Pages', icon: 'chevronRight', accel: 'Mod+PageDown',
    run: () => store.setPage(store.doc().activePage + 1) });
  def({ id: 'page.prev', title: 'Previous page', group: 'Pages', icon: 'chevronLeft', accel: 'Mod+PageUp',
    run: () => store.setPage(store.doc().activePage - 1) });
  def({ id: 'page.rename', title: 'Rename page…', group: 'Pages', icon: 'text',
    run: () => {
      const page = store.page();
      const name = prompt('Page name', page.name);
      if (name) store.mutate(() => { page.name = name; }, 'rename page');
      store.emit('page');
    } });

  /* ------------------------------------------------------------------ */
  /*  Insert                                                             */
  /* ------------------------------------------------------------------ */

  def({ id: 'insert.template', title: 'Insert a template…', group: 'Insert', icon: 'template',
    run: () => ask('ui:templates', { insert: true }) });

  def({ id: 'insert.mindNode', title: 'Add connected node', group: 'Insert', icon: 'mindmap', accel: 'Tab',
    when: () => st.selection.length === 1,
    run: () => C.growMindMap('child') });

  def({ id: 'insert.siblingNode', title: 'Add sibling node', group: 'Insert', icon: 'mindmap',
    when: () => st.selection.length === 1,
    run: () => C.growMindMap('sibling') });

  /** Grow a mind map: spawn a node and wire it to the selected one. */
  C.growMindMap = function (kind) {
    const src = store.selectedFirst();
    if (!src || M.isLinear(src)) return;
    const w = Math.max(150, Math.min(src.w, 240));
    const h = Math.max(64, Math.min(src.h, 110));
    let x = src.x + (kind === 'child' ? src.w + 90 : 0);
    let y = src.y + (kind === 'child' ? 0 : src.h + 50);

    // Nudge down until the slot is free.
    let guard = 0;
    while (guard++ < 40) {
      const probe = { x, y, w, h };
      const clash = store.elements().some((el) => el.id !== src.id && !M.isLinear(el) &&
        G.boxIntersects(G.expand(probe, 12), G.aabb(el)));
      if (!clash) break;
      y += h + 26;
    }

    const node = M.create(src.type === 'note' ? 'note' : 'rect', {
      x, y, w, h,
      fill: src.type === 'note' ? src.fill : (src.fill && src.fill !== 'transparent' ? src.fill : '#ffffff'),
      stroke: src.stroke, strokeWidth: src.strokeWidth, roundness: src.roundness,
      textAlign: 'center', vAlign: 'middle', fontSize: Math.max(14, (src.fontSize || 18) - 2)
    }, st.style);

    const link = M.create('arrow', {
      x: src.x + src.w, y: src.y + src.h / 2,
      points: [[0, 0], [node.x - (src.x + src.w), (node.y + node.h / 2) - (src.y + src.h / 2)]],
      stroke: U.withAlpha(src.stroke === 'transparent' ? '#868e96' : src.stroke, 0.85),
      strokeWidth: Math.max(1.5, (src.strokeWidth || 2) - 0.5),
      arrowEnd: 'none', curve: true
    }, st.style);
    link.start = { id: src.id, gap: 4 };
    link.end = { id: node.id, gap: 4 };
    G.normalizeLinear(link);

    store.addMany([node, link], { select: true });
    store.refreshBindings([node.id, src.id]);
    store.setSelection([node.id]);
    IK.textEditor.start(node, { created: true });
  };

  /* ------------------------------------------------------------------ */
  /*  Help & account                                                     */
  /* ------------------------------------------------------------------ */

  def({ id: 'help.shortcuts', title: 'Keyboard shortcuts', group: 'Help', icon: 'keyboard', accel: 'F1',
    run: () => ask('ui:shortcuts') });
  def({ id: 'help.palette', title: 'Command palette', group: 'Help', icon: 'command', accel: 'Mod+K',
    run: () => ask('ui:palette') });
  def({ id: 'help.about', title: 'About ' + IK.BRAND.name, group: 'Help', icon: 'help',
    run: () => ask('ui:about') });
  def({ id: 'help.site', title: 'Visit the website', group: 'Help', icon: 'link',
    run: () => P.openExternal(IK.BRAND.site) });
  def({ id: 'account.upgrade', title: 'Upgrade to Pro', group: 'Help', icon: 'crown',
    run: () => store.emit('upgrade:show', {}) });
  def({ id: 'account.activate', title: 'Enter a licence key…', group: 'Help', icon: 'check',
    run: () => store.emit('upgrade:show', { activate: true }) });

  /* ------------------------------------------------------------------ */
  /*  Keyboard dispatch                                                  */
  /* ------------------------------------------------------------------ */

  function accelMatches(accel, e) {
    if (!accel) return false;
    const parts = accel.split('+');
    const key = parts[parts.length - 1].toLowerCase();
    const needMod = parts.indexOf('Mod') >= 0;
    const needShift = parts.indexOf('Shift') >= 0;
    const needAlt = parts.indexOf('Alt') >= 0;
    const mod = e.ctrlKey || e.metaKey;
    if (needMod !== mod) return false;
    if (needAlt !== e.altKey) return false;

    const pressed = e.key.toLowerCase();
    const codeKey = (e.code || '').replace('Key', '').replace('Digit', '').toLowerCase();
    let matches = pressed === key || codeKey === key;
    if (key === 'delete') matches = pressed === 'delete' || pressed === 'backspace';
    if (key === '=') matches = pressed === '=' || pressed === '+';
    if (key === '-') matches = pressed === '-' || pressed === '_';
    // With Shift held, the bracket keys report '{' and '}' — match on the
    // physical key so Mod+Shift+] really is "bring to front".
    if (key === '[') matches = pressed === '[' || pressed === '{' || e.code === 'BracketLeft';
    if (key === ']') matches = pressed === ']' || pressed === '}' || e.code === 'BracketRight';
    if (key === 'pagedown') matches = pressed === 'pagedown';
    if (key === 'pageup') matches = pressed === 'pageup';
    if (!matches) return false;

    // Shift must match exactly, or Mod+] would also fire on Mod+Shift+].
    // The one exception is '=' / '-', where the shifted glyph ('+', '_')
    // is what people actually press for zoom.
    const shiftOptional = key === '=' || key === '-';
    if (!shiftOptional && needShift !== e.shiftKey) return false;
    if (shiftOptional && needShift && !e.shiftKey) return false;
    return true;
  }

  C.handleKey = function (e) {
    // Ctrl+Y is the redo key most Windows users reach for.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'y' || e.key === 'Y' || e.code === 'KeyY')) {
      e.preventDefault();
      C.run('edit.redo');
      return true;
    }
    // Paste is left to the browser's own paste event, which is the only
    // place an image on the clipboard can be read. Swallowing the keystroke
    // here would cancel that event and make screenshots unpasteable.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'v' || e.key === 'V' || e.code === 'KeyV')) {
      return true;
    }
    for (const cmd of C.list) {
      if (!cmd.accel) continue;
      if (!accelMatches(cmd.accel, e)) continue;
      if (cmd.when && !cmd.when()) return true;   // swallow it anyway
      e.preventDefault();
      C.run(cmd.id);
      return true;
    }
    return false;
  };

  C.accelMatches = accelMatches;

  IK.commands = C;
})(window.IK = window.IK || {});
