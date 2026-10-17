/* ------------------------------------------------------------------ *
 *  Store — the single source of truth: document, camera, selection,    *
 *  tool, style, history. Everything else reads from here and listens   *
 *  for events.                                                         *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const U = IK.util;
  const M = IK.model;
  const G = IK.geom;

  const bus = U.emitter();

  const state = {
    doc: M.createDocument(),
    camera: { x: 0, y: 0, scale: 1 },
    selection: [],
    tool: 'select',
    lastDrawTool: 'pen',
    style: M.defaultStyle(),
    filePath: null,
    fileName: null,
    dirty: false,
    editingId: null,
    ui: {
      theme: 'system',           // system | light | dark
      snap: true,
      autoShape: true,
      rescueContrast: false,
      gridSnap: false,
      gridSize: 20,
      minimap: false,
      presenting: false,
      laser: false,
      panelsHidden: false,
      readOnly: false,
      lockTool: false,           // keep the current tool after drawing
      eraserMode: 'object',      // object = whole stroke | part = rub out a section
      eraserSize: 16             // radius on screen, in CSS pixels
    }
  };

  const history = { past: [], future: [], batch: 0, pending: null };
  const MAX_HISTORY = 220;

  const S = {
    state,
    on: bus.on,
    off: bus.off,
    emit: bus.emit,

    /* ---- document access ------------------------------------------- */

    doc: () => state.doc,
    page: () => state.doc.pages[state.doc.activePage] || state.doc.pages[0],
    elements: () => S.page().elements,
    byId(id) { return M.byId(S.elements(), id); },
    getById: (id) => M.byId(S.page().elements, id),

    selected() {
      const map = new Set(state.selection);
      return S.elements().filter((el) => map.has(el.id));
    },

    selectedFirst() {
      return state.selection.length === 1 ? S.byId(state.selection[0]) : null;
    },

    /* ---- history ---------------------------------------------------- */

    snapshot() {
      // The active page is part of the snapshot, so undoing "add page" (or
      // an edit made on another page) lands back where the change happened.
      return JSON.stringify({
        active: state.doc.activePage,
        pages: state.doc.pages.map((p) => ({
          id: p.id, name: p.name, background: p.background, canvasColor: p.canvasColor,
          elements: p.elements.map(M.cleanElement)
        }))
      });
    },

    restore(snap) {
      const data = JSON.parse(snap);
      const pages = Array.isArray(data) ? data : data.pages;
      const prevPage = state.doc.activePage;
      state.doc.pages = pages.map((p) => ({
        id: p.id, name: p.name, background: p.background, canvasColor: p.canvasColor,
        elements: p.elements.map(M.upgradeElement)
      }));
      if (!Array.isArray(data) && typeof data.active === 'number') state.doc.activePage = data.active;
      state.doc.activePage = U.clamp(state.doc.activePage, 0, state.doc.pages.length - 1);
      // Hydrate every page, not just this one: exporters and page switches
      // read the others, and a restored image without its bitmap paints blank.
      state.doc.pages.forEach((p) => p.elements.forEach(S.hydrate));
      state.selection = state.selection.filter((id) => !!S.byId(id));
      S.markDirty();
      if (prevPage !== state.doc.activePage || pages.length) bus.emit('page');
      bus.emit('change', { reason: 'history' });
      bus.emit('selection');
    },

    /**
     * Run `fn`, then record one undo step.
     * Nested calls collapse into a single step (see beginBatch/endBatch).
     */
    mutate(fn, label) {
      const before = history.batch > 0 ? null : S.snapshot();
      const result = fn();
      if (history.batch > 0) {
        if (history.pending === null) history.pending = before;
      } else if (before !== null) {
        S.pushUndo(before, label);
      }
      S.markDirty();
      bus.emit('change', { reason: label || 'mutate' });
      return result;
    },

    pushUndo(snap, label) {
      if (snap === undefined || snap === null) return;
      const last = history.past[history.past.length - 1];
      if (last && last.snap === snap) return;
      history.past.push({ snap, label: label || '', at: Date.now() });
      if (history.past.length > MAX_HISTORY) history.past.shift();
      history.future.length = 0;
    },

    /** Group a drag gesture into one undo step. */
    beginBatch() {
      if (history.batch === 0) history.pending = S.snapshot();
      history.batch += 1;
    },

    endBatch(label, discardIfUnchanged) {
      history.batch = Math.max(0, history.batch - 1);
      if (history.batch === 0 && history.pending !== null) {
        const changed = history.pending !== S.snapshot();
        if (changed || !discardIfUnchanged) S.pushUndo(history.pending, label);
        history.pending = null;
        if (changed) { S.markDirty(); bus.emit('change', { reason: label || 'batch' }); }
      }
    },

    cancelBatch() {
      history.batch = 0;
      history.pending = null;
    },

    /** Abandon a gesture: put the board back exactly as it was before it. */
    abortBatch() {
      const snap = history.pending;
      history.batch = 0;
      history.pending = null;
      if (snap !== null && snap !== S.snapshot()) S.restore(snap);
    },

    inBatch: () => history.batch > 0,

    undo() {
      if (!history.past.length) return false;
      const entry = history.past.pop();
      history.future.push({ snap: S.snapshot(), label: entry.label });
      S.restore(entry.snap);
      return true;
    },

    redo() {
      if (!history.future.length) return false;
      const entry = history.future.pop();
      history.past.push({ snap: S.snapshot(), label: entry.label });
      S.restore(entry.snap);
      return true;
    },

    /**
     * Apply `fn` as part of the most recent undo step instead of a new one.
     * Used when a just-created element gets its first text: "add a note"
     * and "type in it" are one action to the person doing it.
     */
    mergeIntoLast(fn, label) {
      if (!history.past.length || history.batch > 0) return S.mutate(fn, label);
      const result = fn();
      history.future.length = 0;
      S.markDirty();
      bus.emit('change', { reason: label || 'mutate' });
      return result;
    },

    /** Drop the newest undo step if undoing it would change nothing. */
    dropRedundantUndo() {
      const last = history.past[history.past.length - 1];
      if (last && last.snap === S.snapshot()) history.past.pop();
    },

    canUndo: () => history.past.length > 0,
    canRedo: () => history.future.length > 0,
    historyDepth: () => history.past.length,

    resetHistory() {
      history.past.length = 0;
      history.future.length = 0;
      history.batch = 0;
      history.pending = null;
    },

    /* ---- elements --------------------------------------------------- */

    hydrate(el) {
      if (el.type === 'image' && el.src && !el.__img) {
        const img = new Image();
        img.onload = () => bus.emit('change', { reason: 'image' });
        img.src = el.src;
        el.__img = img;
      }
      return el;
    },

    add(el, opts) {
      opts = opts || {};
      S.hydrate(el);
      const run = () => {
        S.elements().push(el);
        if (opts.select !== false) S.setSelection([el.id]);
        return el;
      };
      return opts.silent ? run() : S.mutate(run, 'add');
    },

    addMany(list, opts) {
      opts = opts || {};
      return S.mutate(() => {
        list.forEach((el) => { S.hydrate(el); S.elements().push(el); });
        if (opts.select !== false) S.setSelection(list.map((e) => e.id));
        return list;
      }, 'add');
    },

    remove(ids, opts) {
      const kill = new Set(Array.isArray(ids) ? ids : [ids]);
      if (!kill.size) return;
      const run = opts && opts.silent ? (fn) => { fn(); bus.emit('change', { reason: 'delete' }); } : (fn) => S.mutate(fn, 'delete');
      run(() => {
        const page = S.page();
        // Detach bindings pointing at deleted shapes so arrows don't jump.
        page.elements.forEach((el) => {
          if (el.start && kill.has(el.start.id)) el.start = null;
          if (el.end && kill.has(el.end.id)) el.end = null;
        });
        page.elements = page.elements.filter((el) => !kill.has(el.id));
        state.selection = state.selection.filter((id) => !kill.has(id));
      });
      bus.emit('selection');
      if (opts && opts.silent) S.dropRedundantUndo();
    },

    update(id, patch, opts) {
      const el = S.byId(id);
      if (!el) return null;
      const run = () => { Object.assign(el, patch); el.updated = Date.now(); return el; };
      return opts && opts.silent ? run() : S.mutate(run, 'update');
    },

    updateMany(ids, patch) {
      return S.mutate(() => {
        ids.forEach((id) => {
          const el = S.byId(id);
          if (el && !el.locked) { Object.assign(el, patch); el.updated = Date.now(); }
        });
      }, 'style');
    },

    /** Re-run bindings for every connector attached to these element ids. */
    refreshBindings(changedIds) {
      const set = changedIds ? new Set(changedIds) : null;
      const get = (id) => S.byId(id);
      let touched = false;
      for (const el of S.elements()) {
        if (!el.start && !el.end) continue;
        if (set && !(el.start && set.has(el.start.id)) && !(el.end && set.has(el.end.id)) && !set.has(el.id)) continue;
        touched = G.updateBinding(el, get) || touched;
      }
      return touched;
    },

    /* ---- z-order ---------------------------------------------------- */

    reorder(ids, where) {
      const set = new Set(ids);
      S.mutate(() => {
        const page = S.page();
        const moving = page.elements.filter((el) => set.has(el.id));
        const rest = page.elements.filter((el) => !set.has(el.id));
        if (where === 'front') page.elements = rest.concat(moving);
        else if (where === 'back') page.elements = moving.concat(rest);
        else {
          const dir = where === 'forward' ? 1 : -1;
          const arr = page.elements.slice();
          const order = dir > 0
            ? arr.map((e, i) => i).reverse()
            : arr.map((e, i) => i);
          for (const i of order) {
            if (!set.has(arr[i].id)) continue;
            const j = i + dir;
            if (j < 0 || j >= arr.length || set.has(arr[j].id)) continue;
            const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
          }
          page.elements = arr;
        }
      }, 'reorder');
    },

    /* ---- grouping ---------------------------------------------------- */

    group() {
      const sel = S.selected().filter((el) => !el.locked);
      if (sel.length < 2) return;
      const gid = U.uid('g');
      S.mutate(() => sel.forEach((el) => { el.groupId = gid; }), 'group');
    },

    ungroup() {
      const sel = S.selected();
      if (!sel.length) return;
      const groups = new Set(sel.map((el) => el.groupId).filter(Boolean));
      if (!groups.size) return;
      S.mutate(() => {
        S.elements().forEach((el) => { if (groups.has(el.groupId)) el.groupId = null; });
      }, 'ungroup');
    },

    /** Expand a selection so picking one group member picks all of them. */
    expandGroups(ids) {
      const groups = new Set();
      ids.forEach((id) => {
        const el = S.byId(id);
        if (el && el.groupId) groups.add(el.groupId);
      });
      if (!groups.size) return ids;
      const out = new Set(ids);
      S.elements().forEach((el) => { if (el.groupId && groups.has(el.groupId)) out.add(el.id); });
      return Array.from(out);
    },

    /* ---- selection --------------------------------------------------- */

    setSelection(ids, opts) {
      const next = (opts && opts.raw) ? ids.slice() : S.expandGroups(ids.slice());
      const same = next.length === state.selection.length &&
        next.every((id, i) => state.selection[i] === id);
      state.selection = next;
      if (!same) bus.emit('selection', next);
      return next;
    },

    clearSelection() { S.setSelection([]); },

    selectAll() {
      S.setSelection(S.elements().filter((el) => !el.locked && !el.hidden).map((el) => el.id), { raw: true });
    },

    /* ---- tool & style ------------------------------------------------ */

    setTool(tool) {
      if (state.tool === tool) return;
      state.tool = tool;
      if (['pen', 'marker', 'line', 'arrow'].concat(M.SHAPES).indexOf(tool) >= 0) state.lastDrawTool = tool;
      bus.emit('tool', tool);
      bus.emit('change', { reason: 'tool' });
    },

    setStyle(patch, opts) {
      Object.assign(state.style, patch);
      IK.platform.set('style', state.style);
      bus.emit('style', state.style);
      if (!opts || opts.applyToSelection !== false) {
        const ids = state.selection.filter((id) => {
          const el = S.byId(id);
          return el && !el.locked;
        });
        if (ids.length) S.updateMany(ids, patch);
      }
      bus.emit('change', { reason: 'style' });
    },

    /* ---- pages -------------------------------------------------------- */

    addPage(name) {
      return S.mutate(() => {
        const page = M.createPage(name || 'Page ' + (state.doc.pages.length + 1));
        state.doc.pages.push(page);
        state.doc.activePage = state.doc.pages.length - 1;
        state.selection = [];
        bus.emit('page');
        return page;
      }, 'add page');
    },

    duplicatePage(index) {
      return S.mutate(() => {
        const src = state.doc.pages[index === undefined ? state.doc.activePage : index];
        const copy = U.clone({ ...src, elements: src.elements.map(M.cleanElement) });
        copy.id = U.uid('p');
        copy.name = src.name + ' copy';

        // Re-key the elements AND re-point every binding at the copies,
        // otherwise the new page's arrows reference the old page's shapes.
        const idMap = {};
        copy.elements.forEach((el) => {
          const old = el.id;
          el.id = U.uid();
          idMap[old] = el.id;
        });
        copy.elements.forEach((el) => {
          if (el.start) el.start = idMap[el.start.id] ? Object.assign({}, el.start, { id: idMap[el.start.id] }) : null;
          if (el.end) el.end = idMap[el.end.id] ? Object.assign({}, el.end, { id: idMap[el.end.id] }) : null;
          if (el.groupId) el.groupId = el.groupId + '_' + copy.id;
        });

        state.doc.pages.splice(state.doc.activePage + 1, 0, copy);
        state.doc.activePage += 1;
        state.selection = [];
        copy.elements.forEach(S.hydrate);
        bus.emit('page');
        bus.emit('selection');
      }, 'duplicate page');
    },

    removePage(index) {
      if (state.doc.pages.length <= 1) return;
      S.mutate(() => {
        state.doc.pages.splice(index, 1);
        // Removing a page in front of the open one shifts it down by one.
        if (index < state.doc.activePage) state.doc.activePage -= 1;
        state.doc.activePage = U.clamp(state.doc.activePage, 0, state.doc.pages.length - 1);
        state.selection = [];
        bus.emit('page');
      }, 'delete page');
    },

    setPage(index) {
      if (index < 0 || index >= state.doc.pages.length) return;
      if (index === state.doc.activePage) return;
      state.doc.activePage = index;
      state.selection = [];
      S.elements().forEach(S.hydrate);
      bus.emit('page');
      bus.emit('selection');
      bus.emit('change', { reason: 'page' });
    },

    /* ---- camera -------------------------------------------------------- */

    toWorld(sx, sy) {
      const c = state.camera;
      return { x: (sx - c.x) / c.scale, y: (sy - c.y) / c.scale };
    },

    toScreen(wx, wy) {
      const c = state.camera;
      return { x: wx * c.scale + c.x, y: wy * c.scale + c.y };
    },

    /** The world rectangle currently visible. */
    viewport() {
      const a = S.toWorld(0, 0);
      const b = S.toWorld(window.innerWidth, window.innerHeight);
      return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    },

    panBy(dx, dy) {
      state.camera.x += dx;
      state.camera.y += dy;
      bus.emit('camera');
      bus.emit('change', { reason: 'camera' });
    },

    zoomAt(sx, sy, factor) {
      const c = state.camera;
      const before = S.toWorld(sx, sy);
      c.scale = U.clamp(c.scale * factor, 0.04, 24);
      const after = S.toWorld(sx, sy);
      c.x += (after.x - before.x) * c.scale;
      c.y += (after.y - before.y) * c.scale;
      bus.emit('camera');
      bus.emit('change', { reason: 'camera' });
    },

    setZoom(scale, sx, sy) {
      const c = state.camera;
      S.zoomAt(sx === undefined ? window.innerWidth / 2 : sx,
        sy === undefined ? window.innerHeight / 2 : sy,
        U.clamp(scale, 0.04, 24) / c.scale);
    },

    /** Centre the camera on a world box, optionally animated. */
    lookAt(box, opts) {
      opts = opts || {};
      const pad = opts.padding === undefined ? 90 : opts.padding;
      const vw = window.innerWidth, vh = window.innerHeight;
      const scale = opts.scale !== undefined ? opts.scale : U.clamp(
        Math.min(vw / Math.max(1, box.w + pad * 2), vh / Math.max(1, box.h + pad * 2)),
        0.04, opts.maxScale || 2.5
      );
      const target = {
        scale,
        x: vw / 2 - (box.x + box.w / 2) * scale,
        y: vh / 2 - (box.y + box.h / 2) * scale
      };
      if (!opts.animate) {
        Object.assign(state.camera, target);
        bus.emit('camera');
        bus.emit('change', { reason: 'camera' });
        return;
      }
      const from = { ...state.camera };
      const t0 = performance.now();
      const dur = opts.duration || 380;
      (function step(now) {
        const t = U.clamp((now - t0) / dur, 0, 1);
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
        state.camera.x = U.lerp(from.x, target.x, e);
        state.camera.y = U.lerp(from.y, target.y, e);
        state.camera.scale = U.lerp(from.scale, target.scale, e);
        bus.emit('camera');
        bus.emit('change', { reason: 'camera' });
        if (t < 1) requestAnimationFrame(step);
      })(t0);
    },

    zoomToFit(opts) {
      const els = S.elements();
      if (!els.length) {
        Object.assign(state.camera, { x: 0, y: 0, scale: 1 });
        bus.emit('camera');
        bus.emit('change', { reason: 'camera' });
        return;
      }
      S.lookAt(G.aabbOf(els), Object.assign({ maxScale: 1.6 }, opts || {}));
    },

    zoomToSelection(opts) {
      const sel = S.selected();
      if (!sel.length) return S.zoomToFit(opts);
      S.lookAt(G.aabbOf(sel), Object.assign({ maxScale: 2.2, animate: true }, opts || {}));
    },

    /* ---- dirty / title -------------------------------------------------- */

    markDirty() {
      if (!state.dirty) {
        state.dirty = true;
        IK.platform.setDirty(true);
      }
      state.doc.modified = Date.now();
      bus.emit('dirty', true);
    },

    markClean() {
      state.dirty = false;
      IK.platform.setDirty(false);
      bus.emit('dirty', false);
    },

    documentName() {
      if (state.fileName) return state.fileName.replace(/\.[^.]+$/, '');
      return state.doc.title || 'Untitled';
    },

    setDocument(doc, meta) {
      state.doc = doc;
      state.selection = [];
      state.filePath = (meta && meta.path) || null;
      state.fileName = (meta && meta.name) || (meta && meta.path ? String(meta.path).split(/[\\/]/).pop() : null);
      state.doc.pages.forEach((p) => p.elements.forEach(S.hydrate));
      S.resetHistory();
      S.markClean();
      bus.emit('page');
      bus.emit('selection');
      bus.emit('document', doc);
      bus.emit('change', { reason: 'load' });
    }
  };

  IK.store = S;
})(window.IK = window.IK || {});
