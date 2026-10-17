/* ------------------------------------------------------------------ *
 *  Boot & glue — settings, files, autosave, keyboard, theme.           *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const U = IK.util;
  const M = IK.model;
  const G = IK.geom;
  const R = IK.render;
  const store = IK.store;
  const C = IK.commands;
  const L = IK.license;
  const P = IK.platform;
  const X = IK.exporters;
  const D = IK.dialogs;
  const TE = IK.textEditor;
  const BRAND = IK.BRAND;
  const st = store.state;

  window.__inkoraError = null;
  window.addEventListener('error', (e) => {
    window.__inkoraError = e.message;
    console.error('[' + BRAND.name + ']', e.error || e.message);
  });

  /* ------------------------------------------------------------------ */
  /*  Theme                                                              */
  /* ------------------------------------------------------------------ */

  const mediaDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  /** The two neutral inks the app itself picks when nothing is chosen. */
  const DEFAULT_INKS = ['#1e1e21', '#e9eaee'];

  function applyTheme(theme) {
    st.ui.theme = theme;
    P.set('theme', theme);
    const dark = theme === 'dark' || (theme === 'system' && mediaDark && mediaDark.matches);
    document.body.classList.toggle('theme-dark', dark);
    document.body.classList.toggle('theme-light', !dark);
    R.invalidateTheme();
    const btn = document.getElementById('theme-btn');
    if (btn) btn.innerHTML = IK.icon(dark ? 'sun' : 'moon', 20);

    // Existing work is never recoloured. But if the pen is still on one of
    // the app's own default inks, swap it for the one that shows up on this
    // canvas — so switching to dark doesn't hand you an invisible pen.
    const wanted = R.defaultInk();
    if (DEFAULT_INKS.indexOf(st.style.stroke) >= 0 && st.style.stroke !== wanted) {
      st.style.stroke = wanted;
      P.set('style', st.style);
      store.emit('style', st.style);
      if (IK.ui && IK.ui.refreshInspector) IK.ui.refreshInspector();
    }
    R.request();
    offerContrastRescue();
  }

  /**
   * A board drawn on white has dark ink; on a dark canvas some of it will be
   * unreadable. Rather than quietly recolouring the user's work, say so once
   * and offer the fix — which is reversible and only affects painting.
   */
  let rescueOffered = 0;
  function offerContrastRescue() {
    if (st.ui.rescueContrast) return;
    if (Date.now() - rescueOffered < 60000) return;
    const bg = R.canvasColor();
    const hidden = store.elements().filter((el) => {
      if (el.hidden || el.type === 'frame') return false;
      const ink = el.stroke && el.stroke !== 'transparent' ? el.stroke : null;
      const fill = el.fill && el.fill !== 'transparent' ? el.fill : null;
      if (ink && U.contrast(ink, bg) < 1.5) return true;
      return !!(fill && !ink && U.contrast(fill, bg) < 1.5);
    }).length;
    if (!hidden) return;
    rescueOffered = Date.now();
    U.toast(hidden + (hidden === 1 ? ' element is' : ' elements are') + ' hard to see on this canvas', {
      duration: 9000,
      action: {
        label: 'Fix contrast',
        run: () => {
          st.ui.rescueContrast = true;
          P.set('rescueContrast', true);
          store.emit('ui');
          IK.ui.refreshInspector();
          R.request();
          U.toast('Colours are nudged only where they were unreadable — turn it off in Canvas settings');
        }
      }
    });
  }

  if (mediaDark && mediaDark.addEventListener) {
    mediaDark.addEventListener('change', () => { if (st.ui.theme === 'system') applyTheme('system'); });
  }
  store.on('ui:theme', ({ theme }) => applyTheme(theme));

  /* ------------------------------------------------------------------ */
  /*  Files                                                              */
  /* ------------------------------------------------------------------ */

  async function confirmDiscard() {
    if (!st.dirty) return true;
    return confirm('This board has unsaved changes. Discard them?');
  }

  async function newBoard() {
    if (!(await confirmDiscard())) return;
    store.setDocument(M.createDocument(), {});
    Object.assign(st.camera, { x: 0, y: 0, scale: 1 });
    store.emit('camera');
    R.request();
  }

  async function openBoard() {
    if (!(await confirmDiscard())) return;
    const res = await P.openDocument();
    if (!res) return;
    loadText(res.text, { path: res.path, name: res.path });
  }

  /** Open text that arrived from outside (drop, backup, OS) without losing work. */
  async function openIncoming(text, meta) {
    if (!(await confirmDiscard())) return;
    loadText(text, meta);
  }

  function loadText(text, meta) {
    try {
      const doc = M.parse(text);
      store.setDocument(doc, meta || {});
      IK.sketch.clearCache();
      store.zoomToFit({ maxScale: 1.2 });
      U.toast('Opened ' + (doc.title || 'board'));
    } catch (err) {
      console.error(err);
      U.toast('That file could not be opened — is it a ' + BRAND.name + ' board?', { tone: 'error' });
    }
  }

  async function saveBoard(forceDialog) {
    const name = (store.documentName() || 'Untitled') + '.' + BRAND.ext;
    const res = await P.saveDocument(M.serialize(store.doc()), forceDialog ? null : st.filePath, name);
    if (!res) return false;
    st.filePath = res.path;
    st.fileName = String(res.path).split(/[\\/]/).pop();
    store.markClean();
    IK.ui.updateDocChip();
    U.toast('Saved');
    return true;
  }

  async function runExport(opts) {
    opts = opts || {};
    const base = (store.documentName() || 'board').replace(/[^\w\- ]+/g, '').trim() || 'board';
    try {
      if (opts.format === 'svg') {
        if (!L.require('export.svg')) return;
        const svg = X.toSVG(opts);
        await P.saveBinary(base + '.svg', new Blob([svg], { type: 'image/svg+xml' }), 'image/svg+xml');
      } else if (opts.format === 'pdf') {
        if (!L.require('export.pdf')) return;
        U.toast('Building PDF…');
        const blob = await X.toPDF(opts.pdfMode || 'board', opts);
        await P.saveBinary(base + '.pdf', blob, 'application/pdf');
      } else if (opts.format === 'jpg') {
        await P.saveBinary(base + '.jpg', X.toJPEG(opts), 'image/jpeg');
      } else {
        await P.saveBinary(base + '.png', X.toPNG(opts), 'image/png');
      }
      U.toast('Exported');
    } catch (err) {
      console.error(err);
      U.toast('Export failed: ' + err.message, { tone: 'error' });
    }
  }

  function importImage() {
    const input = U.el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (file) await IK.tools.insertImageFile(file);
    };
    document.body.appendChild(input);
    input.click();
  }

  async function printBoard() {
    const dataUrl = X.toPNG({ scale: 2, padding: 40 });
    const frame = U.el('iframe', { class: 'print-frame' });
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    const safeTitle = String(store.documentName()).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    doc.write(`<html><head><title>${safeTitle}</title>
      <style>@page{margin:12mm}body{margin:0}img{width:100%;height:auto}</style></head>
      <body><img src="${dataUrl}"></body></html>`);
    doc.close();
    setTimeout(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 1200);
    }, 320);
  }

  store.on('request:new', newBoard);
  store.on('request:open', openBoard);
  store.on('request:save', ({ as }) => saveBoard(as));
  store.on('request:export', runExport);
  store.on('request:importImage', importImage);
  store.on('request:print', printBoard);
  store.on('request:openText', ({ text, name }) => openIncoming(text, { name }));
  store.on('request:newFromTemplate', ({ id }) => IK.templates.startNew(id));

  /* ------------------------------------------------------------------ */
  /*  Autosave & backups                                                 */
  /* ------------------------------------------------------------------ */

  const autosave = U.debounce(() => {
    try { P.autosave(M.serialize(store.doc(), { filePath: st.filePath })); } catch (e) { /* best effort */ }
  }, 1200);

  store.on('change', autosave);
  store.on('dirty', () => IK.ui.updateDocChip());

  setInterval(() => {
    if (!st.dirty) return;
    try { P.backup(M.serialize(store.doc())); } catch (e) { /* best effort */ }
  }, 5 * 60 * 1000);

  window.addEventListener('beforeunload', (e) => {
    autosave.flush();
    if (st.dirty && P.isWeb) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Keyboard                                                           */
  /* ------------------------------------------------------------------ */

  const TOOL_KEYS = {
    v: 'select', h: 'hand', p: 'pen', m: 'marker', e: 'eraser', l: 'line',
    a: 'arrow', r: 'rect', o: 'ellipse', d: 'diamond', t: 'text', n: 'note',
    f: 'frame', c: 'comment', k: 'laser'
  };

  window.addEventListener('keydown', (e) => {
    const target = e.target;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (typing) return;

    if (IK.present.handleKey(e)) return;

    if (e.code === 'Space' && !e.repeat) {
      IK.tools.setSpace(true);
      e.preventDefault();
      return;
    }

    if (e.key === 'Escape') {
      if (D.isOpen()) { D.close(); return; }
      D.closePopover();
      IK.tools.cancelGesture();
      store.clearSelection();
      return;
    }

    // A dialog owns the keyboard while it is open: Delete must not wipe the
    // selection hiding behind it, arrows must not nudge it, letters must
    // not switch tools. Only the palette shortcut still works.
    if (D.isOpen()) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); D.close(); }
      return;
    }

    // Nudge
    if (st.selection.length && e.key.indexOf('Arrow') === 0) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key];
      store.mutate(() => {
        const sel = store.selected();
        const ids = new Set(sel.map((x) => x.id));
        sel.forEach((el) => {
          if (el.locked) return;
          // A connector nudged without its shapes lets go of them.
          if (el.start && !ids.has(el.start.id)) el.start = null;
          if (el.end && !ids.has(el.end.id)) el.end = null;
          el.x += d[0]; el.y += d[1];
        });
      }, 'nudge');
      store.refreshBindings(st.selection);
      R.request();
      return;
    }

    // Enter starts editing the selected element's label.
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && st.selection.length === 1) {
      const el = store.selectedFirst();
      if (el && M.canHaveText(el) && !el.locked) {
        e.preventDefault();
        TE.start(el, { selectAll: true });
        return;
      }
    }

    if (C.handleKey(e)) return;

    // Bare-letter tool switches (no modifier).
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool) { store.setTool(tool); return; }
      // While the eraser is up, [ and ] size the eraser rather than the pen —
      // that is the thing on screen, and the pen's width is not in play.
      if (e.key === '[') { st.tool === 'eraser' ? adjustEraser(-2) : adjustStroke(-1); return; }
      if (e.key === ']') { st.tool === 'eraser' ? adjustEraser(2) : adjustStroke(1); return; }
      if (e.key === 'q') { C.run('tool.lockToggle'); return; }
      if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const color = M.PALETTE.stroke[idx];
        if (color) store.setStyle({ stroke: color });
        return;
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') IK.tools.setSpace(false);
  });

  function adjustStroke(delta) {
    const next = U.clamp((st.style.strokeWidth || 2) + delta, 1, 32);
    store.setStyle({ strokeWidth: next });
    IK.ui.refreshInspector();
  }

  function adjustEraser(delta) {
    st.ui.eraserSize = U.clamp((st.ui.eraserSize || 16) + delta, 4, 120);
    P.set('eraserSize', st.ui.eraserSize);
    R.overlay.eraserSize = st.ui.eraserSize;
    IK.ui.refreshInspector();
    R.request();
  }

  /* ------------------------------------------------------------------ */
  /*  Paste                                                              */
  /* ------------------------------------------------------------------ */

  window.addEventListener('paste', async (e) => {
    if (TE.isEditing()) return;
    const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
    const image = items.filter((i) => i.type.indexOf('image/') === 0)[0];
    if (image) {
      e.preventDefault();
      const file = image.getAsFile();
      const at = IK.ui.lastPointer;
      if (file) await IK.tools.insertImageFile(file, at && at.x, at && at.y);
      return;
    }
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text) {
      e.preventDefault();
      X.pasteText(text, IK.ui.lastPointer);
    }
  });

  /* ------------------------------------------------------------------ */
  /*  Mind-map: Tab from the text editor grows the map                   */
  /* ------------------------------------------------------------------ */

  store.on('text:tab', (el) => {
    if (!el) return;
    store.setSelection([el.id]);
    C.growMindMap('child');
  });

  /* ------------------------------------------------------------------ */
  /*  Electron menu commands                                             */
  /* ------------------------------------------------------------------ */

  P.onMenu((cmd) => {
    // On macOS the clipboard and undo keys arrive through the menu. When a
    // text field has focus they belong to it, not to the board.
    const active = document.activeElement;
    const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
    const nativeMap = { undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', paste: 'paste', 'select-all': 'selectAll' };
    if (typing && nativeMap[cmd]) { P.nativeEdit(nativeMap[cmd]); return; }
    const map = {
      new: 'file.new', open: 'file.open', save: 'file.save', 'save-as': 'file.saveAs',
      export: 'file.exportPanel', print: 'file.print', undo: 'edit.undo', redo: 'edit.redo',
      cut: 'edit.cut', copy: 'edit.copy', paste: 'edit.paste', duplicate: 'edit.duplicate',
      delete: 'edit.delete', 'select-all': 'edit.selectAll', 'zoom-in': 'view.zoomIn',
      'zoom-out': 'view.zoomOut', 'zoom-reset': 'view.zoomReset', 'zoom-fit': 'view.zoomFit',
      'toggle-dark': 'view.theme', shortcuts: 'help.shortcuts', about: 'help.about',
      present: 'view.present', palette: 'help.palette', templates: 'file.templates',
      upgrade: 'account.upgrade', search: 'view.search'
    };
    if (map[cmd]) C.run(map[cmd]);
  });

  P.onOpenFile((data) => {
    if (!data) return;
    openIncoming(data.text, { path: data.path, name: data.path });
  });

  // The window is closing and the person chose "Save": save, and tell the
  // shell whether it worked so a cancelled Save dialog doesn't lose the board.
  P.onSaveAndClose && P.onSaveAndClose(async () => {
    let ok = false;
    try { ok = await saveBoard(false); } catch (e) { ok = false; }
    P.saveAndCloseDone(ok);
  });

  /* ------------------------------------------------------------------ */
  /*  Boot                                                               */
  /* ------------------------------------------------------------------ */

  async function boot() {
    // Restore settings
    const savedStyle = P.get('style', null);
    if (savedStyle) Object.assign(st.style, savedStyle);
    st.ui.snap = P.get('snap', true);
    st.ui.gridSnap = P.get('gridSnap', false);
    st.ui.autoShape = P.get('autoShape', true);
    st.ui.rescueContrast = P.get('rescueContrast', false);
    st.ui.minimap = P.get('minimap', false);
    st.ui.lockTool = P.get('lockTool', false);
    st.ui.eraserMode = P.get('eraserMode', 'object') === 'part' ? 'part' : 'object';
    st.ui.eraserSize = U.clamp(Number(P.get('eraserSize', 16)) || 16, 4, 200);
    st.ui.touchPan = P.get('touchPan', P.isAndroid || P.isTouch);
    st.ui.theme = P.get('theme', 'system');

    await L.init();

    IK.ui.build();
    applyTheme(st.ui.theme);

    const canvas = document.getElementById('board');
    R.attach(canvas);
    IK.tools.attach(canvas);

    store.setTool('select');

    // Load: file passed on the command line > autosave > empty board
    let loaded = false;
    try {
      const startup = await P.startupFile();
      if (startup && startup.text) {
        loadText(startup.text, { path: startup.path, name: startup.path });
        loaded = true;
      }
    } catch (e) { /* no startup file */ }

    if (!loaded) {
      try {
        const auto = await P.loadAutosave();
        if (auto) {
          const doc = M.parse(auto);
          const count = doc.pages.reduce((n, p) => n + p.elements.length, 0);
          if (count > 0) {
            // The autosave remembers which file the board belongs to, so
            // Save after a restart writes back to it instead of asking again.
            let meta = {};
            try {
              const raw = JSON.parse(auto);
              if (raw && raw.filePath) meta = { path: raw.filePath };
            } catch (e) { /* fine */ }
            store.setDocument(doc, meta);
            store.zoomToFit({ maxScale: 1.2 });
            loaded = true;
          }
        }
      } catch (e) { /* corrupt autosave — start clean */ }
    }

    if (!loaded && !P.get('seenWelcome', false)) {
      setTimeout(() => D.welcome(), 260);
    }

    store.markClean();
    IK.ui.updateDocChip();
    R.request();

    // Trial reminder, gently, once a day.
    if (!L.isPaid() && L.inTrial()) {
      const last = P.get('trialToastAt', 0);
      if (Date.now() - last > 86400000) {
        P.set('trialToastAt', Date.now());
        setTimeout(() => U.toast(L.trialDaysLeft() + ' days left of ' + BRAND.name + ' Pro', {
          action: { label: 'See Pro', run: () => C.run('account.upgrade') }
        }), 2600);
      }
    }

    window.__inkoraBooted = true;
    document.body.classList.add('is-ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  IK.app = { boot, loadText, saveBoard, newBoard, openBoard, runExport, applyTheme };
})(window.IK = window.IK || {});
