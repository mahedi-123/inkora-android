/* ------------------------------------------------------------------ *
 *  Pointer handling — one small state machine for every gesture:       *
 *  draw, select, move, resize, rotate, marquee, pan, pinch, erase,     *
 *  laser, and arrow binding.                                           *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const U = IK.util;
  const M = IK.model;
  const G = IK.geom;
  const R = IK.render;
  const store = IK.store;
  const TE = IK.textEditor;

  const T = {};
  const st = store.state;

  let canvas = null;
  let gesture = null;              // active gesture descriptor
  const pointers = new Map();      // pointerId -> {x,y,type}
  let pinch = null;
  let spaceHeld = false;
  let lastClick = { t: 0, x: 0, y: 0, id: null };

  T.spaceHeld = () => spaceHeld;
  T.setSpace = (v) => {
    spaceHeld = v;
    T.updateCursor();
  };

  /* ------------------------------------------------------------------ */
  /*  Cursors                                                            */
  /* ------------------------------------------------------------------ */

  const CURSORS = {
    select: 'default', hand: 'grab', pen: 'crosshair', marker: 'crosshair',
    eraser: 'crosshair', laser: 'crosshair', text: 'text', note: 'copy',
    frame: 'crosshair', comment: 'copy', image: 'copy'
  };

  T.updateCursor = function (over) {
    if (!canvas) return;
    if (st.ui.presenting) { canvas.style.cursor = st.tool === 'laser' ? 'none' : 'default'; return; }
    if (spaceHeld || st.tool === 'hand') { canvas.style.cursor = gesture && gesture.mode === 'pan' ? 'grabbing' : 'grab'; return; }
    if (over && over.handle) { canvas.style.cursor = over.cursor || 'nwse-resize'; return; }
    canvas.style.cursor = CURSORS[st.tool] || 'crosshair';
  };

  const HANDLE_CURSOR = {
    nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
    n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
    rot: 'grab'
  };

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  const world = (e) => store.toWorld(e.clientX, e.clientY);
  const slack = () => 6 / st.camera.scale;

  function handleAt(sx, sy) {
    const handles = R.selectionHandles();
    const r = st.ui.touchMode || IK.platform.isTouch ? 16 : 10;
    for (const key in handles) {
      const h = handles[key];
      if (Math.abs(sx - h.x) <= r && Math.abs(sy - h.y) <= r) {
        return { handle: key, kind: h.kind, index: h.index, cursor: HANDLE_CURSOR[key] || 'pointer' };
      }
    }
    return null;
  }

  function otherBoxes(excludeIds) {
    const skip = new Set(excludeIds);
    const view = G.expand(store.viewport(), 200 / st.camera.scale);
    const out = [];
    for (const el of store.elements()) {
      if (skip.has(el.id) || el.hidden) continue;
      const b = G.aabb(el);
      if (!G.boxIntersects(view, b)) continue;
      out.push(b);
    }
    return out;
  }

  function bindTargetAt(wx, wy, excludeId) {
    const el = G.pick(store.elements(), wx, wy, 10 / st.camera.scale, {
      filter: (e) => e.id !== excludeId && !M.isLinear(e) && e.type !== 'frame' && e.type !== 'comment'
    });
    return el ? el.id : null;
  }

  function finishDraft(draft, opts) {
    R.overlay.draft = null;
    if (!draft) return null;
    opts = opts || {};
    delete draft.__draft;
    if (M.isLinear(draft)) G.normalizeLinear(draft);

    const tiny = Math.abs(draft.w) < 2 && Math.abs(draft.h) < 2;
    if (tiny && !opts.keepTiny) { R.request(); return null; }

    store.add(draft, { select: opts.select !== false });
    if (!st.ui.lockTool && opts.revert !== false) store.setTool('select');
    R.request();
    return draft;
  }

  /* ------------------------------------------------------------------ */
  /*  Gesture start                                                      */
  /* ------------------------------------------------------------------ */

  function onPointerDown(e) {
    if (e.button === 2) return;                 // right-click => context menu
    if (TE.isEditing() && e.target !== canvas) return;
    if (TE.isEditing()) TE.commit();

    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (pointers.size === 2) { startPinch(); return; }
    if (pointers.size > 2) return;

    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    const w = world(e);
    const panning = st.tool === 'hand' || spaceHeld || e.button === 1 ||
      (st.ui.touchPan && e.pointerType === 'touch' && st.tool === 'select');

    if (panning) {
      gesture = { mode: 'pan', lastX: e.clientX, lastY: e.clientY };
      T.updateCursor();
      return;
    }

    if (st.ui.presenting && st.tool !== 'laser') return;

    // ---- double click ----
    const now = performance.now();
    const isDouble = now - lastClick.t < 380 && U.dist(e.clientX, e.clientY, lastClick.x, lastClick.y) < 8;
    lastClick = { t: now, x: e.clientX, y: e.clientY };
    if (isDouble && st.tool === 'select') { handleDoubleClick(w, e); return; }

    switch (st.tool) {
      case 'select': return startSelect(e, w);
      case 'pen':
      case 'marker': return startFreehand(e, w);
      case 'eraser': return startErase(e, w);
      case 'laser': return startLaser(e, w);
      case 'text':
        TE.start(null, { worldX: w.x, worldY: w.y, created: true });
        if (!st.ui.lockTool) store.setTool('select');
        return;
      case 'note': return dropNote(w);
      case 'comment': return dropComment(w);
      case 'frame': return startShape(e, w, 'frame');
      case 'line':
      case 'arrow': return startLinear(e, w, st.tool);
      default:
        if (M.SHAPES.indexOf(st.tool) >= 0) return startShape(e, w, st.tool);
    }
  }

  /* ---- select / move / resize / rotate ------------------------------ */

  function startSelect(e, w) {
    const h = handleAt(e.clientX, e.clientY);
    if (h) {
      const sel = store.selected();
      store.beginBatch();
      if (h.kind === 'rotate') {
        gesture = { mode: 'rotate', orig: U.clone(sel.map(M.cleanElement)), ids: sel.map((s) => s.id) };
      } else if (h.kind === 'point') {
        const last = (sel[0].points || []).length - 1;
        gesture = {
          mode: 'point', el: sel[0], index: h.index, orig: U.clone(M.cleanElement(sel[0])),
          end: h.index === 0 ? 'start' : h.index === last ? 'end' : null
        };
      } else {
        gesture = {
          mode: 'resize', handle: h.handle,
          ids: sel.map((s) => s.id),
          orig: sel.map((s) => U.clone(M.cleanElement(s))),
          box: G.aabbOf(sel)
        };
      }
      return;
    }

    // The padlock badge is the direct way back from a lock. Clicking a thin
    // stroke exactly is fiddly; clicking the badge beside it is not.
    const badge = R.lockBadgeAt(e.clientX, e.clientY);
    if (badge) {
      store.update(badge.id, { locked: false });
      store.setSelection([badge.id]);
      U.toast('Unlocked');
      R.request();
      return;
    }

    const hit = G.pick(store.elements(), w.x, w.y, slack());
    if (hit) {
      let ids = st.selection.slice();
      if (e.shiftKey) {
        ids = ids.indexOf(hit.id) >= 0 ? ids.filter((id) => id !== hit.id) : ids.concat([hit.id]);
      } else if (ids.indexOf(hit.id) < 0) {
        ids = [hit.id];
      }
      store.setSelection(ids);

      if (st.selection.length) {
        store.beginBatch();
        const ids = st.selection.slice().concat(T.frameContents(store.selected(), st.selection));
        gesture = {
          mode: 'move',
          start: w,
          ids,
          orig: ids.map((id) => store.byId(id)).filter(Boolean).map((s) => ({ id: s.id, x: s.x, y: s.y })),
          alt: e.altKey,
          moved: false
        };
      }
      return;
    }

    // Clicking straight onto a locked element does nothing, which reads as a
    // dead spot on the board. Say what is going on and offer the way out.
    const lockedHit = G.pick(store.elements(), w.x, w.y, slack(), { includeLocked: true });
    if (lockedHit && lockedHit.locked) warnLocked(lockedHit, 'select');

    if (!e.shiftKey) store.clearSelection();
    gesture = { mode: 'marquee', startScreen: { x: e.clientX, y: e.clientY }, base: e.shiftKey ? st.selection.slice() : [] };
  }

  function handleDoubleClick(w, e) {
    const hit = G.pick(store.elements(), w.x, w.y, slack(), { includeLocked: false });
    if (!hit) {
      const locked = G.pick(store.elements(), w.x, w.y, slack(), { includeLocked: true });
      if (locked && locked.locked) { warnLocked(locked, 'select'); return; }
      TE.start(null, { worldX: w.x, worldY: w.y, created: true });
      return;
    }
    if (hit.type === 'frame') {
      const name = prompt('Frame name', hit.name || 'Frame');
      if (name !== null) store.update(hit.id, { name });
      return;
    }
    if (M.canHaveText(hit)) {
      store.setSelection([hit.id]);
      TE.start(hit, { selectAll: !M.textOf(hit) ? false : true });
      return;
    }
    if (M.isLinear(hit)) {
      store.setSelection([hit.id]);
      TE.start(hit, { selectAll: true });
    }
  }

  /* ---- freehand ------------------------------------------------------ */

  function startFreehand(e, w) {
    const brush = st.tool === 'marker' ? 'marker' : 'pen';
    const el = M.create('draw', {
      x: w.x, y: w.y, w: 0.0001, h: 0.0001,
      brush,
      points: [[0, 0]],
      pressures: [pressureOf(e)],
      opacity: brush === 'marker' ? 0.45 : st.style.opacity,
      strokeWidth: brush === 'marker' ? Math.max(6, st.style.strokeWidth * 3) : st.style.strokeWidth,
      fill: 'transparent'
    }, st.style);
    el.__draft = true;
    R.overlay.draft = el;
    gesture = { mode: 'freehand', el, originX: w.x, originY: w.y, last: w };
  }

  function pressureOf(e) {
    if (e.pointerType === 'pen' && e.pressure > 0) return U.clamp(e.pressure, 0.05, 1);
    if (e.pressure && e.pressure !== 0.5 && e.pointerType === 'touch') return U.clamp(e.pressure, 0.1, 1);
    return 0.5;
  }

  /* ---- shapes & connectors ------------------------------------------ */

  function startShape(e, w, type) {
    const el = M.create(type, { x: w.x, y: w.y, w: 0, h: 0 }, st.style);
    if (type === 'frame') {
      el.name = 'Frame ' + (store.elements().filter((x) => x.type === 'frame').length + 1);
    }
    el.__draft = true;
    R.overlay.draft = el;
    gesture = { mode: 'shape', el, start: w, type };
  }

  function startLinear(e, w, type) {
    const route = st.style.route === 'elbow' || st.style.route === 'curve' ? st.style.route : 'straight';
    const el = M.create(type, {
      x: w.x, y: w.y, w: 0.0001, h: 0.0001,
      points: [[0, 0], [0, 0]],
      curve: route === 'curve',
      route
    }, st.style);
    const bindId = bindTargetAt(w.x, w.y, el.id);
    if (bindId) el.start = { id: bindId, gap: 6 };
    el.__draft = true;
    R.overlay.draft = el;
    gesture = { mode: 'linear', el, start: w };
  }

  function dropNote(w) {
    const el = M.create('note', {
      x: w.x - 104, y: w.y - 104,
      fill: st.style.noteColor || M.PALETTE.note[0]
    }, st.style);
    store.add(el);
    if (!st.ui.lockTool) store.setTool('select');
    TE.start(el, { created: true });
  }

  function dropComment(w) {
    const el = M.create('comment', { x: w.x - 15, y: w.y - 30 }, st.style);
    store.add(el);
    if (!st.ui.lockTool) store.setTool('select');
    TE.start(el, { created: true });
  }

  /* ---- eraser & laser ------------------------------------------------ */

  /**
   * The eraser has two modes.
   *
   *   object — touch a stroke and the whole thing goes. Fast for tidying up
   *            a board, and the only sensible behaviour for a shape, a note
   *            or an image, which have no "part" to rub out.
   *   part   — rub out only what the eraser actually passes over, splitting
   *            a freehand stroke into the pieces either side. This is what a
   *            real eraser does, and what people expect when they have drawn
   *            one long line and want half of it gone.
   *
   * `part` falls back to `object` for anything that is not a freehand stroke.
   */

  /** Eraser radius in world units, so it stays the same size on screen. */
  function eraserWorldRadius() {
    return eraserScreenRadius() / st.camera.scale;
  }

  function eraserScreenRadius() {
    return U.clamp(st.ui.eraserSize || 16, 4, 200);
  }

  function startErase(e, w) {
    store.beginBatch();
    gesture = { mode: 'erase', lockedWarned: false };
    eraseAt(w);
  }

  function eraseAt(w) {
    const r = eraserWorldRadius();
    R.overlay.eraserAt = store.toScreen(w.x, w.y);
    R.overlay.eraserSize = eraserScreenRadius();

    const hit = G.pick(store.elements(), w.x, w.y, r);
    if (!hit) {
      // Nothing erasable here — but if a locked element is under the cursor,
      // say so, or the stroke that refuses to disappear looks like a bug.
      const locked = G.pick(store.elements(), w.x, w.y, r, { includeLocked: true });
      if (locked && locked.locked && gesture && !gesture.lockedWarned) {
        gesture.lockedWarned = true;
        warnLocked(locked);
      }
      R.request();
      return;
    }

    if (st.ui.eraserMode === 'part' && hit.type === 'draw') erasePartOf(hit, w, r);
    else eraseWhole(hit);

    IK.platform.haptic(8);
    R.request();
  }

  function eraseWhole(hit) {
    store.mutate(() => {
      const page = store.page();
      page.elements = page.elements.filter((el) => el.id !== hit.id);
      page.elements.forEach((el) => {
        if (el.start && el.start.id === hit.id) el.start = null;
        if (el.end && el.end.id === hit.id) el.end = null;
      });
      // Drop it from the selection too, or the handles hang around
      // pointing at something that no longer exists.
      st.selection = st.selection.filter((id) => id !== hit.id);
    }, 'erase');
  }

  /**
   * Rub a hole in one freehand stroke.
   *
   * Walks the stroke's points, drops those inside the eraser, and rebuilds
   * whatever runs are left as separate strokes. A run of one point is not a
   * stroke, so it is discarded; if nothing survives, the element goes.
   */
  function erasePartOf(hit, w, radius) {
    const raw = hit.points || [];
    if (raw.length < 2) { eraseWhole(hit); return; }
    // Simplified ink keeps few points on straight runs, so the eraser can
    // pass clean between two of them. Resample any segment longer than the
    // eraser before testing, so every part of the line is reachable.
    const step = Math.max(radius * 0.6, 0.5);
    const pts = [];
    const prs = [];
    const pr = (i) => (hit.pressures && hit.pressures[i] !== undefined ? hit.pressures[i] : 0.5);
    for (let i = 0; i < raw.length; i++) {
      if (i > 0) {
        const a = raw[i - 1], b = raw[i];
        const n = Math.floor(U.dist(a[0], a[1], b[0], b[1]) / step);
        for (let k = 1; k < n; k++) {
          const t = k / n;
          pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          prs.push(pr(i - 1) + (pr(i) - pr(i - 1)) * t);
        }
      }
      pts.push(raw[i]);
      prs.push(pr(i));
    }

    // The eraser point in the stroke's own local space.
    const local = G.toLocal(hit, w.x, w.y);
    const r2 = radius * radius;
    const inside = (p) => {
      const dx = p[0] - local.x, dy = p[1] - local.y;
      return dx * dx + dy * dy <= r2;
    };

    const runs = [];
    let run = null;
    let removed = 0;
    for (let i = 0; i < pts.length; i++) {
      if (inside(pts[i])) { run = null; removed++; continue; }
      if (!run) { run = { points: [], pressures: [] }; runs.push(run); }
      run.points.push(pts[i].slice());
      run.pressures.push(prs[i]);
    }

    // The eraser is over the stroke's bounding box but not over any of its
    // points. Rewriting the element now would churn it on every pointer
    // move for no visible change, so leave it be.
    if (!removed) return;

    // A single leftover point is not a stroke — drop those, and if nothing
    // survives at all the whole element goes.
    const keep = runs.filter((s) => s.points.length >= 2);
    if (!keep.length) { eraseWhole(hit); return; }

    store.mutate(() => {
      const page = store.page();
      const at = page.elements.findIndex((el) => el.id === hit.id);
      if (at < 0) return;

      const pieces = keep.map((run) => {
        const piece = M.upgradeElement(Object.assign(M.cleanElement(hit), {
          id: U.uid('e'),
          points: G.simplify(run.points, 0.3),
          pressures: null
        }));
        // Each piece is its own stroke now, so give it its own box and its
        // own seed — otherwise every fragment wobbles identically.
        piece.seed = Math.floor(Math.random() * 1e6);
        // Re-sample the pressures onto the simplified points.
        piece.pressures = piece.points.map((p) => {
          let bi = 0, bd = Infinity;
          for (let j = 0; j < run.points.length; j++) {
            const d = Math.abs(run.points[j][0] - p[0]) + Math.abs(run.points[j][1] - p[1]);
            if (d < bd) { bd = d; bi = j; }
          }
          return run.pressures[bi];
        });
        G.normalizeLinear(piece);
        return piece;
      });

      page.elements.splice(at, 1, ...pieces);
      st.selection = st.selection.filter((id) => id !== hit.id);
    }, 'erase');
  }

  /**
   * Tell the user why an element is ignoring them, and offer the way out.
   * Throttled, because the eraser and the pointer both call this and nobody
   * needs the same message four times in a second.
   */
  let lastLockWarn = 0;
  function warnLocked(el, why) {
    const now = Date.now();
    if (now - lastLockWarn < 2500) return;
    lastLockWarn = now;
    U.toast(why === 'select' ? 'That is locked, so it cannot be moved'
      : 'That is locked, so it cannot be erased', {
      duration: 6000,
      action: {
        label: 'Unlock it',
        run: () => {
          store.update(el.id, { locked: false });
          store.setSelection([el.id]);
          R.request();
        }
      }
    });
  }

  function startLaser(e, w) {
    gesture = { mode: 'laser' };
    R.overlay.laser.push({ x: w.x, y: w.y, t: performance.now() });
  }

  /* ------------------------------------------------------------------ */
  /*  Pointer move                                                       */
  /* ------------------------------------------------------------------ */

  function onPointerMove(e) {
    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    }
    if (pinch && pointers.size >= 2) return updatePinch();

    if (!gesture) {
      // Hover feedback
      if (st.tool === 'select' && !st.ui.presenting) {
        const h = handleAt(e.clientX, e.clientY);
        T.updateCursor(h);
        const w = world(e);
        const hit = h ? null : G.pick(store.elements(), w.x, w.y, slack());
        const id = hit ? hit.id : null;
        if (R.overlay.hoverId !== id) { R.overlay.hoverId = id; R.request(); }
      } else if (st.tool === 'eraser') {
        R.overlay.eraserAt = { x: e.clientX, y: e.clientY };
        R.overlay.eraserSize = eraserScreenRadius();
        R.request();
      }
      return;
    }

    const w = world(e);

    switch (gesture.mode) {
      case 'pan': {
        store.panBy(e.clientX - gesture.lastX, e.clientY - gesture.lastY);
        gesture.lastX = e.clientX;
        gesture.lastY = e.clientY;
        break;
      }

      case 'freehand': {
        const el = gesture.el;
        const lx = w.x - gesture.originX, ly = w.y - gesture.originY;
        const last = el.points[el.points.length - 1];
        const minStep = 1.1 / st.camera.scale;
        if (U.dist(lx, ly, last[0], last[1]) >= minStep) {
          el.points.push([lx, ly]);
          el.pressures.push(pressureOf(e));
          // Keep the live bbox roughly right so culling doesn't clip it.
          el.w = Math.max(el.w, Math.abs(lx)); el.h = Math.max(el.h, Math.abs(ly));
          R.request();
        }
        break;
      }

      case 'shape': {
        const el = gesture.el;
        let x0 = gesture.start.x, y0 = gesture.start.y, x1 = w.x, y1 = w.y;
        if (e.shiftKey) {
          const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
          x1 = x0 + d * Math.sign(x1 - x0 || 1);
          y1 = y0 + d * Math.sign(y1 - y0 || 1);
        }
        if (e.altKey) { // draw from the centre
          el.x = x0 - Math.abs(x1 - x0); el.y = y0 - Math.abs(y1 - y0);
          el.w = Math.abs(x1 - x0) * 2; el.h = Math.abs(y1 - y0) * 2;
        } else {
          el.x = Math.min(x0, x1); el.y = Math.min(y0, y1);
          el.w = Math.abs(x1 - x0); el.h = Math.abs(y1 - y0);
        }
        if (st.ui.gridSnap) {
          el.x = G.snapToGrid(el.x, st.ui.gridSize);
          el.y = G.snapToGrid(el.y, st.ui.gridSize);
          el.w = Math.max(st.ui.gridSize, G.snapToGrid(el.w, st.ui.gridSize));
          el.h = Math.max(st.ui.gridSize, G.snapToGrid(el.h, st.ui.gridSize));
        }
        R.request();
        break;
      }

      case 'linear': {
        const el = gesture.el;
        let end = { x: w.x, y: w.y };
        if (e.shiftKey) {
          const dx = end.x - gesture.start.x, dy = end.y - gesture.start.y;
          const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
          const len = Math.hypot(dx, dy);
          end = { x: gesture.start.x + Math.cos(a) * len, y: gesture.start.y + Math.sin(a) * len };
        }
        el.x = gesture.start.x; el.y = gesture.start.y;
        el.points = [[0, 0], [end.x - gesture.start.x, end.y - gesture.start.y]];
        el.w = Math.max(0.0001, Math.abs(end.x - gesture.start.x));
        el.h = Math.max(0.0001, Math.abs(end.y - gesture.start.y));
        const target = bindTargetAt(end.x, end.y, el.id);
        R.overlay.bindHighlight = target;
        gesture.endBind = target;
        if (el.route === 'elbow' || el.route === 'curve') {
          // Preview the routed path, glued to whatever it would bind to.
          const keepEnd = el.end;
          el.end = target && !(el.start && el.start.id === target) ? { id: target, gap: 6 } : null;
          G.reroute(el, (id) => store.byId(id));
          el.end = keepEnd;
        }
        R.request();
        break;
      }

      case 'move': {
        let dx = w.x - gesture.start.x;
        let dy = w.y - gesture.start.y;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }

        if (gesture.alt && !gesture.cloned) {
          // Alt-drag duplicates instead of moving.
          // Copy everything that is moving — a frame brings its contents.
          const copies = T.cloneElements(gesture.ids.map((id) => store.byId(id)).filter(Boolean));
          store.addMany(copies, { select: true });
          gesture.ids = copies.map((c) => c.id);
          gesture.orig = copies.map((c) => ({ id: c.id, x: c.x, y: c.y }));
          gesture.cloned = true;
        }

        const moving = gesture.ids.map((id) => store.byId(id)).filter(Boolean);
        if (!gesture.unbound && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
          // Dragging a connector away from the shapes it is glued to means
          // "put it here" — let go of any end whose shape isn't moving too.
          const set = new Set(gesture.ids);
          moving.forEach((el) => {
            if (el.start && !set.has(el.start.id)) el.start = null;
            if (el.end && !set.has(el.end.id)) el.end = null;
          });
          gesture.unbound = true;
        }
        moving.forEach((el, i) => {
          const o = gesture.orig[i];
          if (!o) return;
          el.x = o.x + dx;
          el.y = o.y + dy;
        });

        if (st.ui.gridSnap) {
          moving.forEach((el) => {
            el.x = G.snapToGrid(el.x, st.ui.gridSize);
            el.y = G.snapToGrid(el.y, st.ui.gridSize);
          });
          R.overlay.guides = [];
        } else if (st.ui.snap && moving.length) {
          const box = G.aabbOf(moving);
          const snap = G.snapMove(box, otherBoxes(gesture.ids), 7 / st.camera.scale);
          if (snap.dx || snap.dy) moving.forEach((el) => { el.x += snap.dx; el.y += snap.dy; });
          R.overlay.guides = snap.guides;
        }

        gesture.moved = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;
        store.refreshBindings(gesture.ids);
        R.request();
        break;
      }

      case 'resize': {
        const ids = gesture.ids;
        if (ids.length === 1) {
          const el = store.byId(ids[0]);
          if (el) {
            G.resize(el, gesture.orig[0], gesture.handle, w.x, w.y, {
              lockAspect: e.shiftKey || el.type === 'image' || el.type === 'comment',
              min: 4
            });
            if (st.ui.gridSnap) {
              el.w = Math.max(st.ui.gridSize, G.snapToGrid(el.w, st.ui.gridSize));
              el.h = Math.max(st.ui.gridSize, G.snapToGrid(el.h, st.ui.gridSize));
            }
          }
        } else {
          const box = gesture.box;
          let x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
          if (gesture.handle.indexOf('n') >= 0) y0 = w.y;
          if (gesture.handle.indexOf('s') >= 0) y1 = w.y;
          if (gesture.handle.indexOf('w') >= 0) x0 = w.x;
          if (gesture.handle.indexOf('e') >= 0) x1 = w.x;
          let sx = box.w ? (x1 - x0) / box.w : 1;
          let sy = box.h ? (y1 - y0) / box.h : 1;
          if (e.shiftKey) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = s * Math.sign(sx || 1); sy = s * Math.sign(sy || 1); }
          sx = Math.abs(sx) < 0.02 ? 0.02 * Math.sign(sx || 1) : sx;
          sy = Math.abs(sy) < 0.02 ? 0.02 * Math.sign(sy || 1) : sy;
          const ox = gesture.handle.indexOf('w') >= 0 ? box.x + box.w : box.x;
          const oy = gesture.handle.indexOf('n') >= 0 ? box.y + box.h : box.y;
          ids.forEach((id, i) => {
            const el = store.byId(id);
            const o = gesture.orig[i];
            if (!el || !o) return;
            Object.assign(el, U.clone(o));
            G.scaleAbout(el, ox, oy, sx, sy);
          });
        }
        store.refreshBindings(ids);
        R.request();
        break;
      }

      case 'rotate': {
        const ids = gesture.ids;
        const snapDeg = e.shiftKey ? 15 : 0;
        if (ids.length === 1) {
          const el = store.byId(ids[0]);
          if (el) G.rotateTo(el, gesture.orig[0], w.x, w.y, snapDeg);
        } else {
          const box = G.aabbOf(gesture.orig);
          const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
          let angle = Math.atan2(w.y - c.y, w.x - c.x) + Math.PI / 2;
          if (snapDeg) { const step = U.rad(snapDeg); angle = Math.round(angle / step) * step; }
          ids.forEach((id, i) => {
            const el = store.byId(id);
            const o = gesture.orig[i];
            if (!el || !o) return;
            const oc = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
            const p = U.rotate(oc.x, oc.y, c.x, c.y, angle);
            el.angle = (o.angle || 0) + angle;
            el.x = p.x - o.w / 2;
            el.y = p.y - o.h / 2;
          });
        }
        store.refreshBindings(ids);
        R.request();
        break;
      }

      case 'point': {
        const el = gesture.el;
        if (!el) break;
        if ((el.route === 'elbow' || el.route === 'curve') && gesture.end) {
          // Routed connectors are edited by their ends; the path between
          // them is always recomputed, so its point count can change.
          const wp = G.linearPoints(el);
          const target = bindTargetAt(w.x, w.y, el.id);
          R.overlay.bindHighlight = target;
          const other = gesture.end === 'start' ? el.end : el.start;
          const bind = target && !(other && other.id === target) ? { id: target, gap: 6 } : null;
          if (gesture.end === 'start') { wp[0] = [w.x, w.y]; el.start = bind; }
          else { wp[wp.length - 1] = [w.x, w.y]; el.end = bind; }
          G.setWorldPoints(el, [wp[0], wp[wp.length - 1]]);
          G.reroute(el, (id) => store.byId(id));
          R.request();
          break;
        }
        const local = G.toLocal(el, w.x, w.y);
        el.points[gesture.index] = [local.x, local.y];
        G.normalizeLinear(el);
        const target = bindTargetAt(w.x, w.y, el.id);
        R.overlay.bindHighlight = target;
        if (gesture.index === 0) el.start = target ? { id: target, gap: 6 } : null;
        if (gesture.index === el.points.length - 1) el.end = target ? { id: target, gap: 6 } : null;
        if (el.start && el.end && el.start.id === el.end.id) {
          if (gesture.index === 0) el.start = null; else el.end = null;
        }
        R.request();
        break;
      }

      case 'marquee': {
        const s = gesture.startScreen;
        const x = Math.min(s.x, e.clientX), y = Math.min(s.y, e.clientY);
        const rw = Math.abs(e.clientX - s.x), rh = Math.abs(e.clientY - s.y);
        R.overlay.marquee = { x, y, w: rw, h: rh };
        const a = store.toWorld(x, y), b = store.toWorld(x + rw, y + rh);
        const rect = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
        const found = G.pickIn(store.elements(), rect, { touch: e.altKey, includeFrames: true });
        store.setSelection(gesture.base.concat(found.map((el) => el.id)));
        R.request();
        break;
      }

      case 'erase':
        eraseAt(w);
        break;

      case 'laser':
        R.overlay.laser.push({ x: w.x, y: w.y, t: performance.now() });
        if (R.overlay.laser.length > 260) R.overlay.laser.shift();
        R.request();
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Pointer up                                                         */
  /* ------------------------------------------------------------------ */

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) { pinch = null; gesture = null; return; }
    if (!gesture) return;

    const g = gesture;
    gesture = null;
    R.overlay.guides = [];
    R.overlay.bindHighlight = null;
    R.overlay.marquee = null;
    R.overlay.eraserAt = null;

    switch (g.mode) {
      case 'freehand': {
        const el = g.el;
        R.overlay.draft = null;
        if (el.points.length < 2) {
          el.points = [[0, 0]];
        }
        // Classify the stroke as drawn. Simplifying first can leave a clean
        // square with four points, which is too little to recognise.
        const rawWorld = st.ui.autoShape ? G.linearPoints(el) : null;
        el.points = G.simplify(el.points, 0.45 / st.camera.scale);
        el.pressures = el.points.map((p, i) => el.pressures[Math.min(i, el.pressures.length - 1)] || 0.5);
        delete el.__draft;
        G.normalizeLinear(el);

        // Optional: snap a rough sketch to a clean shape.
        if (st.ui.autoShape && rawWorld) {
          const guess = G.recognize(rawWorld);
          if (guess) {
            const clean = makeRecognized(guess);
            if (clean) {
              store.add(clean, { select: true });
              if (!st.ui.lockTool) { /* stay on the pen */ }
              U.toast('Snapped to ' + guess.type, {
                action: { label: 'Keep sketch', run: () => {
                  store.remove([clean.id]);
                  store.add(el, { select: true });
                } }
              });
              R.request();
              return;
            }
          }
        }

        store.add(el, { select: false });
        R.request();
        break;
      }

      case 'shape': {
        const el = g.el;
        if (Math.abs(el.w) < 4 && Math.abs(el.h) < 4) {
          // A click with a shape tool drops a sensible default size.
          const size = el.type === 'frame' ? { w: 960, h: 540 } : { w: 140, h: 110 };
          el.w = size.w; el.h = size.h;
          el.x -= size.w / 2; el.y -= size.h / 2;
        }
        finishDraft(el, { keepTiny: true });
        break;
      }

      case 'linear': {
        const el = g.el;
        const wp = G.linearPoints(el);
        const len = U.dist(wp[0][0], wp[0][1], wp[wp.length - 1][0], wp[wp.length - 1][1]);
        if (len < 4) { R.overlay.draft = null; R.request(); break; }
        if (g.endBind && !(el.start && el.start.id === g.endBind)) el.end = { id: g.endBind, gap: 6 };
        delete el.__draft;
        R.overlay.draft = null;
        G.normalizeLinear(el);
        G.reroute(el, (id) => store.byId(id));
        store.add(el, { select: true });
        store.refreshBindings([el.id]);
        if (!st.ui.lockTool) store.setTool('select');
        R.request();
        break;
      }

      case 'move':
        store.endBatch('move', !g.moved);
        break;

      case 'resize':
        store.endBatch('resize', true);
        break;

      case 'rotate':
        store.endBatch('rotate', true);
        break;

      case 'point':
        store.endBatch('edit point', true);
        break;

      case 'erase':
        store.endBatch('erase', true);
        break;
    }
    T.updateCursor();
    R.request();
  }

  function makeRecognized(guess) {
    const s = st.style;
    if (guess.type === 'line') {
      const el = M.create('line', {
        x: guess.from[0], y: guess.from[1],
        points: [[0, 0], [guess.to[0] - guess.from[0], guess.to[1] - guess.from[1]]]
      }, s);
      G.normalizeLinear(el);
      return el;
    }
    return M.create(guess.type, {
      x: guess.box.x, y: guess.box.y, w: guess.box.w, h: guess.box.h
    }, s);
  }

  /* ------------------------------------------------------------------ */
  /*  Pinch / wheel                                                      */
  /* ------------------------------------------------------------------ */

  const BATCHED = ['move', 'resize', 'rotate', 'point', 'erase'];

  function startPinch() {
    const pts = Array.from(pointers.values());
    if (pts.length < 2) return;
    if (R.overlay.draft) { R.overlay.draft = null; }
    // A second finger turns whatever the first one started into a pinch.
    // Gestures that opened an undo batch must close it, or every later edit
    // would silently fold into a batch that never ends.
    if (gesture && BATCHED.indexOf(gesture.mode) >= 0) store.endBatch(gesture.mode, true);
    gesture = null;
    R.overlay.guides = [];
    R.overlay.marquee = null;
    R.overlay.bindHighlight = null;
    pinch = {
      dist: U.dist(pts[0].x, pts[0].y, pts[1].x, pts[1].y),
      mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
    };
  }

  function updatePinch() {
    const pts = Array.from(pointers.values());
    if (pts.length < 2 || !pinch) return;
    const dist = U.dist(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    if (pinch.dist > 0) store.zoomAt(mid.x, mid.y, dist / pinch.dist);
    store.panBy(mid.x - pinch.mid.x, mid.y - pinch.mid.y);
    pinch.dist = dist;
    pinch.mid = mid;
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      store.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0022));
    } else if (e.shiftKey) {
      store.panBy(-e.deltaY, 0);
    } else {
      const k = e.deltaMode === 1 ? 18 : 1;
      store.panBy(-e.deltaX * k, -e.deltaY * k);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Images: drop & paste                                               */
  /* ------------------------------------------------------------------ */

  T.insertImageFile = function (file, screenX, screenY) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result);
        const img = new Image();
        img.onload = () => {
          const w0 = store.toWorld(
            screenX === undefined ? window.innerWidth / 2 : screenX,
            screenY === undefined ? window.innerHeight / 2 : screenY
          );
          const maxDim = 460;
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = img.width * scale, h = img.height * scale;
          const el = M.create('image', {
            x: w0.x - w / 2, y: w0.y - h / 2, w, h,
            src, naturalW: img.width, naturalH: img.height
          });
          el.__img = img;
          store.add(el, { select: true });
          R.request();
          resolve(el);
        };
        img.onerror = () => resolve(null);
        img.src = src;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  };

  /* ------------------------------------------------------------------ */
  /*  Wiring                                                             */
  /* ------------------------------------------------------------------ */

  T.attach = function (canvasEl) {
    canvas = canvasEl;
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', () => {
      if (!gesture && R.overlay.eraserAt) { R.overlay.eraserAt = null; R.request(); }
    });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const w = world(e);
      // Look for an unlocked element first, and fall back to a locked one.
      // Locked elements are deliberately unclickable, but the right-click
      // menu is the only place to unlock them — if the pick skipped them the
      // element would be locked forever with no way back.
      const hit = G.pick(store.elements(), w.x, w.y, slack()) ||
        G.pick(store.elements(), w.x, w.y, slack(), { includeLocked: true });
      // Selecting it is still off-limits; a locked element must not become
      // draggable just because it was right-clicked.
      if (hit && !hit.locked && st.selection.indexOf(hit.id) < 0) store.setSelection([hit.id]);
      if (!hit && !e.shiftKey) store.clearSelection();
      store.emit('contextmenu', { x: e.clientX, y: e.clientY, element: hit });
    });

    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      const images = files.filter((f) => f.type.startsWith('image/'));
      for (let i = 0; i < images.length; i++) {
        await T.insertImageFile(images[i], e.clientX + i * 28, e.clientY + i * 28);
      }
      const board = files.find((f) => /\.(inkora|novaboard|json)$/i.test(f.name));
      if (board && !images.length) {
        const text = await board.text();
        store.emit('request:openText', { text, name: board.name });
      }
    });

    store.on('tool', () => T.updateCursor());
    T.updateCursor();
  };

  /**
   * A frame is a container: dragging it takes along everything that sits
   * wholly inside it (unless that thing is locked or already moving).
   * Returns the extra ids to move.
   */
  T.frameContents = function (selected, already) {
    const frames = selected.filter((el) => el.type === 'frame' && !el.locked);
    if (!frames.length) return [];
    const skip = new Set(already);
    const out = [];
    store.elements().forEach((el) => {
      if (skip.has(el.id) || el.locked || el.hidden || el.type === 'frame') return;
      const b = G.aabb(el);
      if (frames.some((f) => G.boxContains(G.aabb(f), b))) { out.push(el.id); skip.add(el.id); }
    });
    return out;
  };

  /**
   * Deep-copy elements with fresh ids. Connectors whose ends are also being
   * copied are re-pointed at the copies; ends pointing outside the set are
   * released. Every group gets a brand-new id, so copying a group twice
   * gives two independent groups rather than one merged one.
   */
  T.cloneElements = function (list, dx, dy) {
    const idMap = {};
    const groupMap = {};
    const copies = list.map((el) => {
      const c = U.clone(M.cleanElement(el));
      c.id = U.uid();
      idMap[el.id] = c.id;
      if (c.groupId) c.groupId = groupMap[c.groupId] || (groupMap[c.groupId] = U.uid('g'));
      c.x += dx || 0; c.y += dy || 0;
      c.seed = Math.floor(Math.random() * 100000);
      return c;
    });
    copies.forEach((c) => {
      if (c.start) c.start = idMap[c.start.id] ? Object.assign({}, c.start, { id: idMap[c.start.id] }) : null;
      if (c.end) c.end = idMap[c.end.id] ? Object.assign({}, c.end, { id: idMap[c.end.id] }) : null;
      if (c.frameId && idMap[c.frameId]) c.frameId = idMap[c.frameId];
    });
    return copies;
  };

  T.currentGesture = () => gesture;
  T.cancelGesture = function () {
    if (!gesture) return;
    // Escape mid-drag puts everything back where it was.
    const mode = gesture.mode;
    gesture = null;
    if (BATCHED.indexOf(mode) >= 0) store.abortBatch();
    R.overlay.draft = null;
    R.overlay.marquee = null;
    R.overlay.guides = [];
    R.request();
  };

  IK.tools = T;
})(window.IK = window.IK || {});
