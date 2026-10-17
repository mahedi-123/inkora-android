/* ------------------------------------------------------------------ *
 *  In-place text editing.                                              *
 *                                                                      *
 *  A textarea is parked exactly over the element and styled to match    *
 *  it (font, size, colour, alignment, zoom, rotation), so typing feels  *
 *  like typing on the canvas itself.                                    *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const U = IK.util;
  const M = IK.model;
  const G = IK.geom;
  const R = IK.render;
  const store = IK.store;

  const T = {};
  let ta = null;
  let current = null;      // element being edited
  let createdHere = false; // true when the element was made just for this edit
  let originalText = '';   // what it said before this edit, for Escape
  let originalBox = null;  // and the size it had, for undo
  let onDone = null;

  function ensure() {
    if (ta) return ta;
    ta = U.el('textarea', {
      id: 'text-editor',
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'sentences',
      wrap: 'soft'
    });
    document.body.appendChild(ta);

    ta.addEventListener('blur', () => T.commit());
    ta.addEventListener('input', () => {
      if (!current) return;
      current.text = ta.value;
      if (current.type === 'text') autoSize();
      else fitFont();
      R.request();
      sync();
    });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        T.commit({ cancel: true });
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        T.commit();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const done = current;
        T.commit();
        store.emit('text:tab', done);
      }
    });
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    ta.addEventListener('wheel', (e) => e.stopPropagation());
    return ta;
  }

  function autoSize() {
    if (!current) return;
    const probe = Object.assign({}, current, { w: 100000, h: 100000 });
    const size = R.measureTextBlock(probe);
    current.w = Math.max(24, Math.min(size.w + 8, current.maxWidth || 1400));
    const wrapped = R.measureTextBlock(current);
    current.h = Math.max((current.fontSize || 20) * 1.32, wrapped.h);
  }

  function fitFont() {
    // Notes and shapes keep their box; layoutText shrinks the type to fit.
    R.layoutText(current);
  }

  function sync() {
    if (!current || !ta) return;
    const cam = store.state.camera;
    const layout = R.layoutText(current) || { size: current.fontSize || 20, pad: R.padding(current) };
    const pad = layout.pad === undefined ? R.padding(current) : layout.pad;

    const topLeft = G.toWorld(current, 0, 0);
    const s = store.toScreen(topLeft.x, topLeft.y);

    const style = ta.style;
    style.display = 'block';
    style.left = s.x + 'px';
    style.top = s.y + 'px';
    style.width = Math.max(20, current.w) + 'px';
    style.height = Math.max(20, current.h) + 'px';
    style.padding = pad + 'px';
    style.font = R.fontSpec(current, layout.size);
    style.lineHeight = (layout.size * 1.32) + 'px';
    style.textAlign = current.textAlign || 'left';
    style.color = current.textColor ||
      (current.type === 'note' ? U.readableInk(current.fill)
        : current.type === 'text' ? current.stroke : (current.stroke !== 'transparent' ? current.stroke : R.theme().ink));
    style.transformOrigin = '0 0';
    style.transform = `scale(${cam.scale}) rotate(${current.angle || 0}rad)`;
    style.caretColor = R.theme().accent;

    if (current.vAlign === 'middle') {
      const layoutH = layout.height || 0;
      style.paddingTop = Math.max(pad, (current.h - layoutH) / 2) + 'px';
    }
  }

  /**
   * Start editing.
   * @param {object|null} el      element to edit (null => create a text box)
   * @param {object} opts         {worldX, worldY, selectAll, created, done}
   */
  T.start = function (el, opts) {
    opts = opts || {};
    if (current) T.commit();
    ensure();

    createdHere = !!opts.created;
    onDone = opts.done || null;

    if (!el) {
      el = M.create('text', {
        x: opts.worldX, y: opts.worldY,
        w: 24, h: (store.state.style.fontSize || 20) * 1.32,
        stroke: store.state.style.stroke,
        textAlign: 'left', vAlign: 'top', text: ''
      }, store.state.style);
      store.add(el, { select: true });
      createdHere = true;
    }

    current = el;
    originalText = M.textOf(el);
    originalBox = { w: el.w, h: el.h };
    store.state.editingId = el.id;
    el.__editing = true;

    ta.value = originalText;
    sync();
    document.body.classList.add('is-editing-text');

    // Focus on the next tick: focusing inside the pointer event would be
    // undone by the click's own default action, which would blur the editor
    // and immediately discard the empty element we just made.
    setTimeout(() => {
      ta.focus({ preventScroll: true });
      if (opts.selectAll) ta.select();
      else ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 0);

    R.request();
  };

  T.isEditing = () => !!current;
  T.element = () => current;

  T.commit = function (opts) {
    if (!current) return;
    opts = opts || {};
    const el = current;
    // Escape abandons the edit: a brand-new element disappears, an existing
    // one goes back to exactly what it said before.
    const value = opts.cancel ? (createdHere ? '' : originalText) : ta.value;
    current = null;
    store.state.editingId = null;
    delete el.__editing;

    ta.style.display = 'none';
    ta.value = '';
    document.body.classList.remove('is-editing-text');

    const live = store.byId(el.id);
    if (!live) return;

    // Typing wrote straight into the element so the canvas could show it.
    // Put the old text back for a moment, so the undo snapshot taken by
    // mutate() records the board as it was before this edit.
    live.text = originalText;
    if (originalBox && live.type === 'text') { live.w = originalBox.w; live.h = originalBox.h; }

    const apply = () => {
      live.text = value;
      if (live.type === 'text') {
        const probe = Object.assign({}, live, { w: 100000, h: 100000 });
        const size = R.measureTextBlock(probe);
        live.w = Math.max(24, Math.min(size.w + 8, live.maxWidth || 1400));
        live.h = Math.max((live.fontSize || 20) * 1.32, R.measureTextBlock(live).h);
      }
      live.updated = Date.now();
    };

    const empty = !String(value).trim() && live.type === 'text';
    if (empty && createdHere) {
      // A text box that never got any text: take it away along with the
      // undo step that created it, so it leaves no trace in history.
      store.remove([live.id], { silent: true });
    } else if (empty) {
      store.remove([live.id]);
    } else if (value !== originalText) {
      if (createdHere) store.mergeIntoLast(apply, 'text');
      else store.mutate(apply, 'text');
      store.refreshBindings([live.id]);
    } else {
      apply();
    }
    originalText = '';
    originalBox = null;

    R.request();
    if (onDone) { const cb = onDone; onDone = null; cb(live); }
    store.emit('text:commit', live);
  };

  /** Keep the overlay glued to the element while the camera moves. */
  store.on('camera', () => { if (current) sync(); });
  store.on('change', () => { if (current) sync(); });

  IK.textEditor = T;
})(window.IK = window.IK || {});
