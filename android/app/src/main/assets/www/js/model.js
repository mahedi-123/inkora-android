/* ------------------------------------------------------------------ *
 *  Document model — elements, pages, defaults, (de)serialisation.      *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const U = IK.util;
  const BRAND = IK.BRAND;

  const M = {};

  /* ---- palettes ---------------------------------------------------- */

  /**
   * Presets only — every one of these rows also gets a custom picker with
   * hex entry and recent colours, so any colour at all is reachable.
   */
  M.PALETTE = {
    stroke: [
      '#1e1e21', '#495057', '#adb5bd', '#ffffff',
      '#e03131', '#f76707', '#f08c00', '#f59f00',
      '#66a80f', '#2f9e44', '#0ca678', '#0c8599',
      '#1971c2', '#3b5bdb', '#7048e8', '#9c36b5',
      '#c2255c', '#e64980', '#846358', '#0b7285'
    ],
    fill: [
      'transparent', '#ffffff', '#f1f3f5', '#dee2e6',
      '#ffe3e3', '#ffd8a8', '#fff3bf', '#f4fce3',
      '#d3f9d8', '#c3fae8', '#c5f6fa', '#d0ebff',
      '#dbe4ff', '#e5dbff', '#f3d9fa', '#ffdeeb',
      '#e03131', '#f59f00', '#2f9e44', '#1971c2'
    ],
    note: [
      '#ffe9a8', '#ffd8a8', '#ffc9c9', '#ffdeeb',
      '#e5dbff', '#c5e3ff', '#c3fae8', '#d8f5a2',
      '#e9ecef', '#ced4da'
    ],
    canvas: [
      '#ffffff', '#fbf8f3', '#f4f6f9', '#eef4ff',
      '#f8f0fc', '#eafaf1', '#22242b', '#16171b',
      '#101820', '#1c1c1a'
    ],
    text: [
      '#1e1e21', '#495057', '#ffffff', '#e03131',
      '#f08c00', '#2f9e44', '#1971c2', '#7048e8'
    ]
  };

  M.FONTS = {
    hand: '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", cursive',
    sans: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: '"JetBrains Mono", "Cascadia Code", Consolas, "Courier New", monospace'
  };

  /** Types that behave like a polyline (points array in local space). */
  M.LINEAR = ['draw', 'line', 'arrow', 'elbow'];
  /** Closed shapes drawn from their bounding box. */
  M.SHAPES = ['rect', 'ellipse', 'diamond', 'triangle', 'star', 'hexagon', 'cylinder', 'cloud', 'bubble', 'parallelogram'];
  /** Types that can carry a text label. */
  M.TEXTY = ['text', 'note', 'comment'].concat(M.SHAPES);

  /* ---- defaults ---------------------------------------------------- */

  M.defaultStyle = function () {
    return {
      stroke: '#1e1e21',
      fill: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'solid',
      sketch: 0,
      roundness: 0.35,
      opacity: 1,
      fontFamily: 'sans',
      fontSize: 20,
      fontWeight: 400,
      textAlign: 'left',
      arrowEnd: 'arrow',
      arrowStart: 'none',
      noteColor: '#ffe9a8'
    };
  };

  const BASE = () => ({
    id: U.uid(),
    type: 'rect',
    x: 0, y: 0, w: 0, h: 0,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    groupId: null,
    stroke: '#1e1e21',
    fill: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    sketch: 0,
    roundness: 0.35,
    seed: Math.floor(Math.random() * 100000),
    text: '',
    fontFamily: 'sans',
    fontSize: 20,
    fontWeight: 400,
    textAlign: 'center',
    vAlign: 'middle',
    textColor: null,
    updated: Date.now()
  });

  /**
   * Create an element. `props` overrides anything in the base shape.
   * Style is pulled from the current style object when given.
   */
  M.create = function (type, props, style) {
    const el = BASE();
    el.type = type;
    if (style) {
      el.stroke = style.stroke;
      el.fill = style.fill;
      el.fillStyle = style.fillStyle;
      el.strokeWidth = style.strokeWidth;
      el.strokeStyle = style.strokeStyle;
      el.sketch = style.sketch;
      el.roundness = style.roundness;
      el.opacity = style.opacity;
      el.fontFamily = style.fontFamily;
      el.fontSize = style.fontSize;
      el.fontWeight = style.fontWeight;
    }

    if (M.LINEAR.indexOf(type) >= 0) {
      el.points = [[0, 0]];
      el.pressures = [0.5];
      el.curve = type === 'draw';
      el.start = null;
      el.end = null;
      el.arrowStart = style ? style.arrowStart : 'none';
      el.arrowEnd = type === 'arrow' ? (style ? style.arrowEnd : 'arrow') : 'none';
      el.fill = 'transparent';
    }

    if (type === 'text') {
      el.textAlign = (style && style.textAlign) || 'left';
      el.vAlign = 'top';
      el.fill = 'transparent';
      el.w = 240; el.h = 32;
    }

    if (type === 'note') {
      el.w = 208; el.h = 208;
      el.fill = (style && style.noteColor) || M.PALETTE.note[0];
      el.stroke = 'transparent';
      el.fontSize = 18;
      el.textAlign = 'left';
      el.vAlign = 'top';
    }

    if (type === 'comment') {
      el.w = 30; el.h = 30;
      el.fill = '#ffd43b';
      el.fontSize = 14;
      el.author = '';
      el.resolved = false;
    }

    if (type === 'frame') {
      el.name = 'Frame';
      el.stroke = '#9aa3b2';
      el.fill = 'transparent';
      el.strokeWidth = 1.5;
      el.sketch = 0;
    }

    if (type === 'image') {
      el.src = '';
      el.naturalW = 0;
      el.naturalH = 0;
      el.fill = 'transparent';
      el.stroke = 'transparent';
      el.cornerRadius = 0;
    }

    if (type === 'table') {
      el.rows = 3; el.cols = 3;
      el.cells = [];
      el.w = 360; el.h = 160;
    }

    Object.assign(el, props || {});
    return el;
  };

  /* ---- pages & document -------------------------------------------- */

  M.createPage = function (name) {
    return {
      id: U.uid('p'),
      name: name || 'Page 1',
      background: 'dots',
      canvasColor: null,        // null => follow theme
      elements: []
    };
  };

  M.createDocument = function () {
    const doc = {
      format: BRAND.ext,
      version: 2,
      id: U.uid('doc'),
      title: 'Untitled',
      created: Date.now(),
      modified: Date.now(),
      pages: [M.createPage('Page 1')],
      activePage: 0
    };
    return doc;
  };

  /* ---- serialisation ----------------------------------------------- */

  /** Anything prefixed `__` is runtime-only and never written to a file. */
  M.cleanElement = function (el) {
    const out = {};
    for (const k in el) {
      if (k.charCodeAt(0) === 95 && k.charCodeAt(1) === 95) continue;
      if (el[k] === undefined) continue;
      out[k] = el[k];
    }
    return out;
  };

  M.serialize = function (doc, extra) {
    const payload = {
      format: BRAND.ext,
      version: 2,
      generator: BRAND.name + ' ' + BRAND.version,
      id: doc.id,
      title: doc.title,
      created: doc.created,
      modified: Date.now(),
      activePage: doc.activePage,
      pages: doc.pages.map((p) => ({
        id: p.id,
        name: p.name,
        background: p.background,
        canvasColor: p.canvasColor,
        elements: p.elements.map(M.cleanElement)
      }))
    };
    if (extra) Object.assign(payload, extra);
    return JSON.stringify(payload);
  };

  /**
   * Parse a document. Understands:
   *   - Inkora v2 files
   *   - legacy NovaBoard v1 files (flat element list, absolute stroke points)
   *   - a bare array of elements
   */
  M.parse = function (text) {
    const data = typeof text === 'string' ? JSON.parse(text) : text;

    if (data && data.version === 2 && Array.isArray(data.pages)) {
      const doc = M.createDocument();
      doc.id = data.id || doc.id;
      doc.title = data.title || 'Untitled';
      doc.created = data.created || Date.now();
      doc.modified = data.modified || Date.now();
      doc.pages = data.pages.map((p) => ({
        id: p.id || U.uid('p'),
        name: p.name || 'Page',
        background: p.background || 'dots',
        canvasColor: p.canvasColor || null,
        elements: (p.elements || []).map(M.upgradeElement)
      }));
      if (!doc.pages.length) doc.pages = [M.createPage()];
      doc.activePage = U.clamp(data.activePage || 0, 0, doc.pages.length - 1);
      return doc;
    }

    // ---- legacy NovaBoard ----
    // `data` can be anything JSON.parse returns, null included ("null" is
    // valid JSON), so nothing below may assume it is an object.
    const legacy = Array.isArray(data) ? data
      : (data && Array.isArray(data.els)) ? data.els : [];
    const doc = M.createDocument();
    doc.title = 'Imported board';
    doc.pages[0].background = (data && data.bgStyle) || 'dots';
    doc.pages[0].elements = legacy.map(M.fromLegacy).filter(Boolean);
    return doc;
  };

  /**
   * Fill in fields added after a file was written, and make sure the
   * numbers really are numbers.
   *
   * A file can be hand-edited, truncated, or written by an older build, and
   * one NaN width propagates through every bounding box, hit test and camera
   * fit on the board. Coercing here means a damaged file opens as a slightly
   * wrong board rather than an unusable one.
   */
  const NUMERIC = {
    x: 0, y: 0, w: 1, h: 1, angle: 0, opacity: 1,
    strokeWidth: 2, fontSize: 20, seed: 1, sketch: 0, roundness: 0
  };

  M.upgradeElement = function (raw) {
    const el = Object.assign(BASE(), raw && typeof raw === 'object' ? raw : {});
    if (typeof el.type !== 'string' || !el.type) el.type = 'rect';

    Object.keys(NUMERIC).forEach((k) => {
      const v = Number(el[k]);
      if (!Number.isFinite(v)) el[k] = NUMERIC[k];
      else el[k] = v;
    });
    el.w = Math.abs(el.w) || 1;
    el.h = Math.abs(el.h) || 1;
    el.opacity = Math.min(1, Math.max(0, el.opacity));

    if (M.LINEAR.indexOf(el.type) >= 0) {
      const pts = Array.isArray(el.points)
        ? el.points.filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
          .map((p) => [Number(p[0]), Number(p[1])])
        : [];
      el.points = pts.length ? pts : [[0, 0]];
    }
    // Only freehand strokes carry a pressure per point; lines and arrows keep
    // a single nominal value, so the lengths are expected to differ there.
    if (el.type === 'draw' && Array.isArray(el.pressures) && el.pressures.length !== el.points.length) {
      const src = el.pressures;
      el.pressures = el.points.map((p, i) => {
        const v = Number(src[i]);
        return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
      });
    }
    if (el.text !== undefined && el.text !== null && typeof el.text !== 'string') {
      el.text = String(el.text);
    }
    return el;
  };

  /** Convert one NovaBoard v1 element to the new schema. */
  M.fromLegacy = function (old) {
    if (!old || !old.type) return null;
    const common = {
      id: old.id || U.uid(),
      stroke: old.color || '#1e1e21',
      strokeWidth: old.size || 2,
      strokeStyle: old.dash ? 'dashed' : 'solid',
      fill: old.fill ? U.withAlpha(old.color || '#1e1e21', 0.2) : 'transparent',
      fillStyle: 'solid',
      opacity: old.tool === 'highlighter' ? 0.4 : 1
    };

    if (old.type === 'stroke') {
      const pts = (old.points || []).map((p) => [p.x, p.y]);
      if (!pts.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      pts.forEach(([x, y]) => {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      });
      return M.create('draw', Object.assign({}, common, {
        x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY),
        points: pts.map(([x, y]) => [x - minX, y - minY]),
        pressures: pts.map(() => 0.5),
        strokeWidth: old.tool === 'highlighter' ? (old.size || 4) * 3 : (old.size || 2),
        curve: true
      }));
    }

    if (old.type === 'line' || old.type === 'arrow') {
      const x = Math.min(old.x1, old.x2), y = Math.min(old.y1, old.y2);
      return M.create(old.type, Object.assign({}, common, {
        x, y,
        w: Math.abs(old.x2 - old.x1), h: Math.abs(old.y2 - old.y1),
        points: [[old.x1 - x, old.y1 - y], [old.x2 - x, old.y2 - y]],
        arrowEnd: old.type === 'arrow' ? 'arrow' : 'none',
        curve: false
      }));
    }

    if (old.type === 'note') {
      return M.create('note', {
        id: common.id,
        x: old.x, y: old.y, w: old.w || 200, h: old.h || 160,
        fill: old.color || M.PALETTE.note[0],
        stroke: 'transparent',
        text: old.text || '',
        fontSize: 18, textAlign: 'left', vAlign: 'top'
      });
    }

    if (old.type === 'text') {
      return M.create('text', {
        id: common.id,
        x: old.x, y: old.y,
        w: Math.max(60, (old.w || 200)), h: Math.max(24, old.h || 28),
        text: old.text || '',
        stroke: old.color || '#1e1e21',
        fontSize: old.fontSize || 20,
        textAlign: 'left', vAlign: 'top'
      });
    }

    if (old.type === 'image') {
      return M.create('image', {
        id: common.id, x: old.x, y: old.y, w: old.w, h: old.h, src: old.src || ''
      });
    }

    if (M.SHAPES.indexOf(old.type) >= 0) {
      return M.create(old.type, Object.assign({}, common, {
        x: Math.min(old.x, old.x + old.w),
        y: Math.min(old.y, old.y + old.h),
        w: Math.abs(old.w), h: Math.abs(old.h)
      }));
    }
    return null;
  };

  /* ---- queries ------------------------------------------------------ */

  M.byId = function (elements, id) {
    for (let i = 0; i < elements.length; i++) if (elements[i].id === id) return elements[i];
    return null;
  };

  M.textOf = function (el) {
    return typeof el.text === 'string' ? el.text : '';
  };

  M.isContainer = (el) => M.SHAPES.indexOf(el.type) >= 0 || el.type === 'note' || el.type === 'frame';
  M.isLinear = (el) => M.LINEAR.indexOf(el.type) >= 0;
  M.canHaveText = (el) => M.TEXTY.indexOf(el.type) >= 0;

  IK.model = M;
})(window.IK = window.IK || {});
