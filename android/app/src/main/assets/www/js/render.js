/* ------------------------------------------------------------------ *
 *  Renderer — paints the board, the overlays and the minimap.          *
 *                                                                      *
 *  Element painting is written against a plain 2D context in world     *
 *  space, so the exporters can reuse it for PNG/PDF output.            *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const U = IK.util;
  const M = IK.model;
  const G = IK.geom;
  const SK = IK.sketch;
  const store = IK.store;

  const R = {};

  let canvas = null;
  let ctx = null;
  let dpr = 1;
  let frameRequested = false;

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');

  /* ------------------------------------------------------------------ */
  /*  Theme                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Reading CSS custom properties means a style recalculation, and the
   * painters ask for the theme per element — so it is resolved once and
   * cached until something that could change it happens.
   */
  let themeCache = null;

  R.theme = function () {
    if (themeCache) return themeCache;
    const cs = getComputedStyle(document.body);
    const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
    themeCache = {
      canvas: v('--canvas', '#ffffff'),
      grid: v('--canvas-grid', 'rgba(20,24,33,0.10)'),
      ink: v('--ink', '#1e1e21'),
      accent: v('--accent', '#4c6ef5'),
      selection: v('--accent', '#4c6ef5'),
      frame: v('--frame-line', '#9aa3b2'),
      dark: document.body.classList.contains('theme-dark')
    };
    return themeCache;
  };

  R.invalidateTheme = function () {
    themeCache = null;
    layoutGeneration += 1;
    patternCache.clear();
  };

  /**
   * Colours are painted exactly as picked. What you choose in the palette is
   * what lands on the canvas and in every export, in both themes — no silent
   * shifting, which is the only behaviour that can be reasoned about.
   *
   * The optional "rescue unreadable colours" setting (off by default) nudges
   * a colour toward the ink only when it is genuinely invisible against the
   * canvas — and only as far as it takes to become visible, so a dark grey
   * stays a dark grey rather than snapping to white.
   */
  let themeIsDark = false;
  const MIN_CONTRAST = 1.9;

  R.canvasColor = function () {
    const page = store.page();
    return (page && page.canvasColor) || R.theme().canvas;
  };

  R.adapt = function (color) {
    if (!color || color === 'transparent' || color[0] !== '#') return color;
    if (!store.state.ui.rescueContrast) return color;
    const bg = R.canvasColor();
    if (U.contrast(color, bg) >= MIN_CONTRAST) return color;
    const target = U.luminance(bg) > 0.5 ? '#000000' : '#ffffff';
    let out = color;
    for (let i = 0; i < 14 && U.contrast(out, bg) < MIN_CONTRAST; i++) out = U.mix(out, target, 0.14);
    return out;
  };
  R.setDarkPainting = function (v) { themeIsDark = !!v; };

  /** The ink colour a fresh stroke should use on the current canvas. */
  R.defaultInk = function () {
    return U.luminance(R.canvasColor()) > 0.5 ? '#1e1e21' : '#e9eaee';
  };

  /**
   * Blend mode for highlighter strokes. `multiply` is right on a light
   * canvas and turns the stroke to mud on a dark one; `screen` is the
   * mirror image and keeps the same "translucent ink" feel.
   */
  R.markerBlend = function () {
    return U.luminance(R.canvasColor()) > 0.5 ? 'multiply' : 'screen';
  };

  /** What a swatch should look like given the live theme. */
  R.previewColor = function (color) {
    const theme = R.theme();
    const was = themeIsDark;
    themeIsDark = theme.dark;
    const out = R.adapt(color);
    themeIsDark = was;
    return out;
  };

  /* ------------------------------------------------------------------ */
  /*  Canvas setup                                                       */
  /* ------------------------------------------------------------------ */

  R.attach = function (canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    R.resize();
    window.addEventListener('resize', R.resize);
    store.on('page', R.invalidateTheme);
    store.on('document', R.invalidateTheme);
    store.on('change', R.request);
    store.on('camera', R.request);
    store.on('selection', R.request);
    store.on('page', R.request);
  };

  R.resize = function () {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    R.request();
  };

  R.request = function () {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => { frameRequested = false; R.draw(); });
  };

  /* ------------------------------------------------------------------ */
  /*  Text layout                                                        */
  /* ------------------------------------------------------------------ */

  R.fontSpec = function (el, sizeOverride) {
    const family = M.FONTS[el.fontFamily] || M.FONTS.sans;
    const weight = el.fontWeight || 400;
    const style = el.fontStyle === 'italic' ? 'italic ' : '';
    return `${style}${weight} ${sizeOverride || el.fontSize || 18}px ${family}`;
  };

  function wrap(text, maxWidth, font) {
    measureCtx.font = font;
    const out = [];
    const paragraphs = String(text).split('\n');
    for (const para of paragraphs) {
      if (!para) { out.push(''); continue; }
      let line = '';
      const words = para.split(/(\s+)/);
      for (const word of words) {
        const test = line + word;
        if (measureCtx.measureText(test).width > maxWidth && line.trim()) {
          out.push(line.replace(/\s+$/, ''));
          line = word.replace(/^\s+/, '');
        } else {
          line = test;
        }
      }
      // A single very long word still has to break somewhere.
      while (measureCtx.measureText(line).width > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measureCtx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
      out.push(line);
    }
    return out;
  }

  R.padding = function (el) {
    if (el.type === 'note') return 16;
    if (el.type === 'text') return 2;
    return Math.min(18, Math.max(8, Math.min(Math.abs(el.w), Math.abs(el.h)) * 0.12));
  };

  /**
   * Lay out an element's label. Sticky notes and shapes shrink their text to
   * fit; plain text boxes grow instead (the caller resizes the element).
   */
  /**
   * Layouts are cached on the element, and the cache is validated by
   * comparing the fields it depends on rather than building a key string.
   * Composing a key per element per frame allocated thousands of strings a
   * second and showed up as multi-hundred-millisecond GC pauses.
   */
  let layoutGeneration = 0;

  R.layoutText = function (el) {
    const text = M.textOf(el);
    if (!text) return null;

    const c = el.__layout;
    if (c &&
        c.gen === layoutGeneration &&
        c.text === text &&
        c.w === el.w && c.h === el.h &&
        c.fs === el.fontSize && c.ff === el.fontFamily && c.fw === el.fontWeight &&
        c.al === el.textAlign && c.va === el.vAlign) {
      return c.v;
    }

    const layout = computeLayout(el, text);
    el.__layout = {
      gen: layoutGeneration, v: layout,
      text, w: el.w, h: el.h,
      fs: el.fontSize, ff: el.fontFamily, fw: el.fontWeight,
      al: el.textAlign, va: el.vAlign
    };
    return layout;
  };

  function computeLayout(el, text) {
    const pad = R.padding(el);
    const maxW = Math.max(12, Math.abs(el.w) - pad * 2);
    const maxH = Math.max(12, Math.abs(el.h) - pad * 2);
    let size = el.fontSize || 18;

    let lines = wrap(text, maxW, R.fontSpec(el, size));
    if (el.type !== 'text' && el.autoShrink !== false) {
      // Estimate the size that fits from the overflow ratio, then settle in
      // a couple of passes — far cheaper than shrinking 0.5px at a time.
      let guard = 0;
      while (lines.length * size * 1.32 > maxH && size > 7 && guard++ < 8) {
        const ratio = maxH / (lines.length * size * 1.32);
        size = Math.max(7, Math.min(size - 0.5, size * Math.sqrt(ratio) * 0.98));
        lines = wrap(text, maxW, R.fontSpec(el, size));
      }
    }
    const lineHeight = size * 1.32;
    const height = lines.length * lineHeight;
    // Line widths are measured once here rather than per frame while painting.
    const font = R.fontSpec(el, size);
    measureCtx.font = font;
    const widths = lines.map((l) => measureCtx.measureText(l).width);
    return { lines, size, lineHeight, height, pad, maxW, font, widths };
  }

  R.measureTextBlock = function (el) {
    const layout = R.layoutText(el);
    if (!layout) return { w: 40, h: (el.fontSize || 20) * 1.32 };
    const widths = layout.widths || [];
    let w = 0;
    for (let i = 0; i < widths.length; i++) w = Math.max(w, widths[i]);
    return { w: w + 2, h: layout.height };
  };

  /**
   * Level of detail. When the camera is zoomed out, text is smaller than a
   * few pixels and hand-drawn jitter and hatching are invisible — so the
   * painter skips that work instead of doing it at 2 fps.
   */
  let lod = 1;
  R.setLod = function (scale) { lod = scale || 1; };

  function paintText(c, el) {
    // Cheap rejection first: if even the unshrunk size is sub-pixel there is
    // no point laying the text out at all.
    if ((el.fontSize || 18) * lod < 4.5) return;
    const layout = R.layoutText(el);
    if (!layout) return;
    if (layout.size * lod < 4.5) return;         // unreadable at this zoom
    const { lines, size, lineHeight, pad } = layout;
    c.font = layout.font;
    c.textBaseline = 'alphabetic';

    let color = el.textColor;
    if (!color) {
      if (el.type === 'note') color = U.readableInk(el.fill);
      else if (el.type === 'text') color = el.stroke;
      else color = el.stroke && el.stroke !== 'transparent' ? el.stroke : R.theme().ink;
    }
    c.fillStyle = el.type === 'note' ? color : R.adapt(color);

    const align = el.textAlign || 'left';
    const boxW = Math.abs(el.w) - pad * 2;
    const totalH = lines.length * lineHeight;
    let y = pad;
    if (el.vAlign === 'middle') y = (Math.abs(el.h) - totalH) / 2;
    else if (el.vAlign === 'bottom') y = Math.abs(el.h) - totalH - pad;
    y += size;

    for (let i = 0; i < lines.length; i++) {
      const lw = layout.widths ? layout.widths[i] : measureCtx.measureText(lines[i]).width;
      let x = pad;
      if (align === 'center') x = pad + (boxW - lw) / 2;
      else if (align === 'right') x = pad + boxW - lw;
      c.fillText(lines[i], x, y - size * 0.22);
      y += lineHeight;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Element painting (world space)                                     */
  /* ------------------------------------------------------------------ */

  function dashPattern(el) {
    const w = Math.max(1, el.strokeWidth || 2);
    if (el.strokeStyle === 'dashed') return [w * 3.2, w * 2.4];
    if (el.strokeStyle === 'dotted') return [0.1, w * 2.6];
    return [];
  }

  function applyStroke(c, el, scale) {
    c.strokeStyle = R.adapt(el.stroke);
    c.lineWidth = Math.max(0.4, el.strokeWidth || 2);
    c.lineCap = el.strokeStyle === 'dotted' ? 'round' : 'round';
    c.lineJoin = 'round';
    c.setLineDash(dashPattern(el));
  }

  function paintFill(c, el) {
    if (!el.fill || el.fill === 'transparent' || el.fillStyle === 'none') return;
    const subs = G.outline(el);
    if ((el.fillStyle === 'hachure' || el.fillStyle === 'cross') && Math.min(el.w, el.h) * lod < 26) {
      // The hatch lines would merge into a wash; paint the wash directly.
      c.save();
      c.globalAlpha = (c.globalAlpha || 1) * 0.5;
      c.fillStyle = R.adapt(el.fill);
      G.tracePath(c, el);
      c.fill();
      c.restore();
      return;
    }
    if (el.fillStyle === 'hachure' || el.fillStyle === 'cross') {
      c.save();
      c.beginPath();
      subs.forEach((s) => {
        s.pts.forEach((p, i) => (i === 0 ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1])));
        c.closePath();
      });
      c.clip();
      const gap = Math.max(5, Math.min(14, Math.min(Math.abs(el.w), Math.abs(el.h)) / 9));
      const segs = SK.cached(el, () =>
        SK.hachure(subs[0].pts, -41, gap, el.seed).concat(
          el.fillStyle === 'cross' ? SK.hachure(subs[0].pts, 41, gap, el.seed + 3) : []),
      '__hatch');
      c.strokeStyle = R.adapt(el.fill);
      c.lineWidth = Math.max(1, (el.strokeWidth || 2) * 0.7);
      c.setLineDash([]);
      c.beginPath();
      segs.forEach(([a, b]) => { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); });
      c.stroke();
      c.restore();
      return;
    }
    c.fillStyle = R.adapt(el.fill);
    if (el.sketch > 0) {
      c.beginPath();
      subs.forEach((s) => {
        const passes = SK.strokePasses(s.pts, { seed: el.seed, roughness: el.sketch * 0.6, closed: true });
        SK.trace(c, passes[0]);
      });
      c.fill();
    } else {
      G.tracePath(c, el);
      c.fill();
    }
  }

  function paintShapeStroke(c, el) {
    if (!el.stroke || el.stroke === 'transparent' || !el.strokeWidth) return;
    applyStroke(c, el);
    if (el.sketch > 0 && lod > 0.35) {
      const subs = G.outline(el);
      const buildPasses = () => {
        const all = [];
        subs.forEach((s) => {
          SK.strokePasses(s.pts, { seed: el.seed, roughness: el.sketch, closed: s.closed })
            .forEach((p) => all.push(p));
        });
        return all;
      };
      const passes = el.__draft ? buildPasses() : SK.cached(el, buildPasses);
      passes.forEach((p, i) => {
        c.globalAlpha = (c.globalAlpha || 1) * (i === 0 ? 1 : 0.75);
        SK.trace(c, p);
        c.stroke();
      });
    } else {
      G.tracePath(c, el);
      c.stroke();
    }
    c.setLineDash([]);
  }

  function paintArrowHead(c, kind, x, y, angle, size, color, filled) {
    if (!kind || kind === 'none') return;
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    c.setLineDash([]);
    c.strokeStyle = R.adapt(color);
    c.fillStyle = R.adapt(color);
    if (kind === 'dot') {
      c.beginPath();
      c.arc(0, 0, size * 0.42, 0, Math.PI * 2);
      c.fill();
    } else if (kind === 'triangle') {
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(-size, -size * 0.42);
      c.lineTo(-size, size * 0.42);
      c.closePath();
      c.fill();
    } else if (kind === 'bar') {
      c.beginPath();
      c.moveTo(0, -size * 0.55);
      c.lineTo(0, size * 0.55);
      c.stroke();
    } else {
      c.beginPath();
      c.moveTo(-size, -size * 0.55);
      c.lineTo(0, 0);
      c.lineTo(-size, size * 0.55);
      c.stroke();
    }
    c.restore();
  }

  function paintLinear(c, el) {
    const pts = el.points || [];
    if (pts.length < 2) {
      if (pts.length === 1 && el.type === 'draw') {
        c.fillStyle = R.adapt(el.stroke);
        c.beginPath();
        c.arc(pts[0][0], pts[0][1], Math.max(0.8, (el.strokeWidth || 2) / 2), 0, Math.PI * 2);
        c.fill();
      }
      return;
    }

    if (el.type === 'draw') {
      if (el.brush === 'marker') {
        c.save();
        // A highlighter multiplies because that is what translucent ink does
        // on paper. On a dark canvas multiply drives everything towards black
        // and the stroke disappears, so use its mirror image there.
        if (lod > 0.4) c.globalCompositeOperation = R.markerBlend();
        c.strokeStyle = R.adapt(el.stroke);
        c.lineWidth = (el.strokeWidth || 2) * 3.4;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.setLineDash([]);
        c.beginPath();
        pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
        c.stroke();
        c.restore();
        return;
      }
      c.setLineDash([]);
      c.fillStyle = R.adapt(el.stroke);

      // Zoomed out, a tapered outline is indistinguishable from a plain
      // line — and rebuilding its curves for every stroke is what makes a
      // big board crawl. Stroke the polyline instead.
      if (lod < 0.55) {
        c.strokeStyle = R.adapt(el.stroke);
        c.lineWidth = el.strokeWidth || 2;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.beginPath();
        for (let i = 0; i < pts.length; i++) {
          if (i) c.lineTo(pts[i][0], pts[i][1]); else c.moveTo(pts[i][0], pts[i][1]);
        }
        c.stroke();
        return;
      }

      // Pressure-tapered ink: fill the stroke's outline. The finished path is
      // cached as a Path2D so a still frame costs one fill call per stroke.
      const build = () => {
        const outline = SK.inkOutline(pts, el.pressures, el.strokeWidth || 2, { taper: el.taper !== false });
        const cmds = G.smoothPath(outline);
        const path = new Path2D();
        path.moveTo(outline[0][0], outline[0][1]);
        cmds.forEach((cmd) => {
          if (cmd.c === 'C') path.bezierCurveTo(cmd.c1[0], cmd.c1[1], cmd.c2[0], cmd.c2[1], cmd.p[0], cmd.p[1]);
          else path.lineTo(cmd.p[0], cmd.p[1]);
        });
        path.closePath();
        return path;
      };
      c.fill(el.__draft ? build() : SK.cached(el, build));
      return;
    }

    applyStroke(c, el);
    if (el.sketch > 0 && lod > 0.35) {
      const buildPasses = () => SK.strokePasses(pts, { seed: el.seed, roughness: el.sketch, closed: false });
      const passes = el.__draft ? buildPasses() : SK.cached(el, buildPasses);
      passes.forEach((p) => { SK.trace(c, p); c.stroke(); });
    } else if (el.curve && pts.length > 2) {
      const cmds = G.smoothPath(pts);
      c.beginPath();
      c.moveTo(pts[0][0], pts[0][1]);
      cmds.forEach((cmd) => {
        if (cmd.c === 'C') c.bezierCurveTo(cmd.c1[0], cmd.c1[1], cmd.c2[0], cmd.c2[1], cmd.p[0], cmd.p[1]);
        else c.lineTo(cmd.p[0], cmd.p[1]);
      });
      c.stroke();
    } else {
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.stroke();
    }
    c.setLineDash([]);

    const headSize = Math.max(9, (el.strokeWidth || 2) * 3.6);
    const a = pts[0], a2 = pts[1];
    const z = pts[pts.length - 1], z2 = pts[pts.length - 2];
    if (el.arrowEnd && el.arrowEnd !== 'none') {
      paintArrowHead(c, el.arrowEnd, z[0], z[1], Math.atan2(z[1] - z2[1], z[0] - z2[0]), headSize, el.stroke);
    }
    if (el.arrowStart && el.arrowStart !== 'none') {
      paintArrowHead(c, el.arrowStart, a[0], a[1], Math.atan2(a[1] - a2[1], a[0] - a2[0]), headSize, el.stroke);
    }

    // Label riding on the middle of the connector.
    if (M.textOf(el)) {
      const mid = pts[Math.floor(pts.length / 2)];
      const layout = R.layoutText({ ...el, w: 200, h: 40, type: 'text', vAlign: 'middle', textAlign: 'center' });
      if (layout) {
        measureCtx.font = layout.font;
        const tw = Math.max.apply(null, layout.lines.map((l) => measureCtx.measureText(l).width));
        c.save();
        c.fillStyle = R.canvasColor();
        c.globalAlpha = 0.9;
        c.fillRect(mid[0] - tw / 2 - 5, mid[1] - layout.size, tw + 10, layout.height + 4);
        c.globalAlpha = 1;
        c.fillStyle = R.adapt(el.textColor || el.stroke);
        c.font = layout.font;
        c.textBaseline = 'middle';
        c.textAlign = 'center';
        layout.lines.forEach((line, i) => {
          c.fillText(line, mid[0], mid[1] - layout.height / 2 + layout.lineHeight * (i + 0.5) - 2);
        });
        c.textAlign = 'left';
        c.restore();
      }
    }
  }

  function paintNote(c, el) {
    const small = el.w * lod < 90;
    c.save();
    if (!small) {
      c.shadowColor = 'rgba(15,20,30,0.20)';
      c.shadowBlur = 14;
      c.shadowOffsetY = 5;
    }
    c.fillStyle = el.fill;
    G.tracePath(c, el);
    c.fill();
    c.restore();
    if (!small) {
      // A hint of a fold so notes read as paper.
      c.save();
      c.globalAlpha = 0.08;
      c.fillStyle = '#000';
      c.beginPath();
      c.moveTo(el.w, el.h - 22);
      c.lineTo(el.w, el.h);
      c.lineTo(el.w - 22, el.h);
      c.closePath();
      c.fill();
      c.restore();
    }
    paintText(c, el);
  }

  function paintFrame(c, el, opts) {
    c.save();
    c.setLineDash([]);
    c.fillStyle = opts && opts.exporting ? R.canvasColor() : 'rgba(127,140,160,0.05)';
    c.fillRect(0, 0, el.w, el.h);
    c.strokeStyle = R.theme().frame;
    c.lineWidth = 1.25;
    c.strokeRect(0, 0, el.w, el.h);
    if (!opts || !opts.exporting) {
      c.fillStyle = R.theme().frame;
      c.font = '600 13px ' + M.FONTS.sans;
      c.textBaseline = 'alphabetic';
      c.fillText(el.name || 'Frame', 2, -7);
    }
    c.restore();
  }

  function paintComment(c, el) {
    c.save();
    c.fillStyle = el.resolved ? '#adb5bd' : (el.fill || '#ffd43b');
    c.strokeStyle = 'rgba(0,0,0,0.18)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(el.w * 0.5, el.h);
    c.lineTo(el.w * 0.16, el.h * 0.72);
    c.arc(el.w / 2, el.h * 0.45, el.w * 0.5, Math.PI * 0.75, Math.PI * 0.25);
    c.closePath();
    c.fill();
    c.stroke();
    c.fillStyle = '#33322c';
    c.font = '600 13px ' + M.FONTS.sans;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('💬', el.w / 2, el.h * 0.42);
    c.textAlign = 'left';
    c.restore();
  }

  function paintImage(c, el) {
    if (el.__img && el.__img.complete && el.__img.naturalWidth) {
      c.save();
      if (el.cornerRadius) { G.tracePath(c, el); c.clip(); }
      c.drawImage(el.__img, 0, 0, el.w, el.h);
      c.restore();
    } else {
      c.save();
      c.fillStyle = 'rgba(140,150,165,0.16)';
      c.fillRect(0, 0, el.w, el.h);
      c.strokeStyle = 'rgba(140,150,165,0.5)';
      c.setLineDash([6, 5]);
      c.strokeRect(0.5, 0.5, el.w - 1, el.h - 1);
      c.restore();
    }
  }

  /**
   * Paint one element. The context must already be in world coordinates.
   */
  R.paintElement = function (c, el, opts) {
    if (el.hidden) return;
    opts = opts || {};
    const prevLod = lod;
    if (opts.exporting) lod = opts.lod || 1e6;   // never skip detail in an export
    c.save();
    c.globalAlpha = (opts.alpha === undefined ? 1 : opts.alpha) * (el.opacity === undefined ? 1 : el.opacity);
    c.translate(el.x + el.w / 2, el.y + el.h / 2);
    if (el.angle) c.rotate(el.angle);
    c.translate(-el.w / 2, -el.h / 2);

    switch (el.type) {
      case 'draw':
      case 'line':
      case 'arrow':
      case 'elbow':
        paintLinear(c, el);
        break;
      case 'note':
        paintNote(c, el);
        break;
      case 'text':
        paintText(c, el);
        break;
      case 'image':
        paintImage(c, el);
        break;
      case 'frame':
        paintFrame(c, el, opts);
        break;
      case 'comment':
        if (!opts.exporting || opts.includeComments) paintComment(c, el);
        break;
      default:
        paintFill(c, el);
        paintShapeStroke(c, el);
        if (M.textOf(el)) paintText(c, el);
    }
    c.restore();
    lod = prevLod;
  };

  /* ------------------------------------------------------------------ */
  /*  Background                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * The background is periodic, so it is drawn once into a small tile and
   * then repeated as a pattern. Looping over every dot each frame cost
   * ~12,000 arcs on a zoomed-out board.
   */
  const patternCache = new Map();

  function backgroundPattern(c, style, step, theme, dotR) {
    const key = style + '|' + Math.round(step * 100) + '|' + theme.grid + '|' + Math.round(dotR * 100);
    const hit = patternCache.get(key);
    if (hit) return hit;

    const size = Math.max(2, Math.round(step));
    const tile = document.createElement('canvas');
    const ratio = 2;                                  // keep the dot crisp
    tile.width = tile.height = size * ratio;
    const t = tile.getContext('2d');
    t.scale(ratio, ratio);
    t.strokeStyle = theme.grid;
    t.fillStyle = theme.grid;

    if (style === 'dots') {
      t.beginPath();
      t.arc(size / 2, size / 2, dotR, 0, Math.PI * 2);
      t.fill();
    } else if (style === 'grid') {
      t.lineWidth = 1 / ratio;
      t.beginPath();
      t.moveTo(0.5, 0); t.lineTo(0.5, size);
      t.moveTo(0, 0.5); t.lineTo(size, 0.5);
      t.stroke();
    } else if (style === 'lines') {
      t.lineWidth = 1 / ratio;
      t.beginPath();
      t.moveTo(0, 0.5); t.lineTo(size, 0.5);
      t.stroke();
    }

    const pattern = c.createPattern(tile, 'repeat');
    const entry = { pattern, size, ratio };
    if (patternCache.size > 24) patternCache.clear();
    patternCache.set(key, entry);
    return entry;
  }

  R.paintBackground = function (c, cam, w, h, page, theme) {
    c.fillStyle = page.canvasColor || theme.canvas;
    c.fillRect(0, 0, w, h);
    const style = page.background || 'dots';
    if (style === 'blank') return;

    const base = 24;
    let step = base * cam.scale;
    while (step < 9) step *= 4;
    while (step > 120) step /= 2;
    const offX = ((cam.x % step) + step) % step;
    const offY = ((cam.y % step) + step) % step;

    if (style === 'dots' || style === 'grid' || style === 'lines') {
      const dotR = U.clamp(cam.scale * 0.85, 0.6, 1.8);
      const entry = backgroundPattern(c, style, step, theme, dotR);
      if (entry && entry.pattern) {
        c.save();
        // The tile is drawn at 2x for crispness, so scale back down.
        const inv = 1 / entry.ratio;
        c.translate(offX - (style === 'dots' ? entry.size / 2 : 0), offY - (style === 'dots' ? entry.size / 2 : 0));
        c.scale(entry.ratio * inv, entry.ratio * inv);
        if (entry.pattern.setTransform) {
          entry.pattern.setTransform(new DOMMatrix([inv, 0, 0, inv, 0, 0]));
        }
        c.fillStyle = entry.pattern;
        c.fillRect(-step, -step, w + step * 2, h + step * 2);
        c.restore();
        return;
      }
    }

    c.strokeStyle = theme.grid;
    c.fillStyle = theme.grid;
    c.lineWidth = 1;

    if (style === 'iso') {
      c.beginPath();
      const t = Math.tan(Math.PI / 6);
      const span = w + h * t;
      for (let x = offX - h * t; x < span; x += step) {
        c.moveTo(x, 0); c.lineTo(x + h * t, h);
        c.moveTo(x, h); c.lineTo(x + h * t, 0);
      }
      c.stroke();
    } else {
      // Fallback if patterns are unavailable for some reason.
      c.beginPath();
      for (let y = offY; y < h; y += step) { c.moveTo(0, Math.round(y) + 0.5); c.lineTo(w, Math.round(y) + 0.5); }
      c.stroke();
    }
  };

  /* ------------------------------------------------------------------ */
  /*  Overlays (screen space)                                            */
  /* ------------------------------------------------------------------ */

  R.overlay = {
    marquee: null,      // {x,y,w,h} in screen coords
    guides: [],         // world-space alignment guides
    laser: [],          // [{x,y,t}] world points
    hoverId: null,
    bindHighlight: null,
    linkPreview: null,
    eraserAt: null,
    eraserSize: 0,
    // Set while the eraser or select tool is live, so locked elements
    // announce themselves exactly when someone is trying to hit one.
    showLocks: false
  };

  function paintSelectionUI(c, theme) {
    const sel = store.selected();
    const cam = store.state.camera;
    if (!sel.length) return;

    c.save();
    c.lineWidth = 1.25;
    c.strokeStyle = theme.selection;

    const single = sel.length === 1 ? sel[0] : null;

    if (single && M.isLinear(single) && single.type !== 'draw' && !single.locked && !store.state.ui.readOnly) {
      // A connector is shown by its end handles; a box around it only
      // muddies an elbow or a diagonal line.
    } else if (single) {
      const cs = G.corners(single);
      c.beginPath();
      cs.forEach((p, i) => {
        const s = store.toScreen(p.x, p.y);
        i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y);
      });
      c.closePath();
      c.stroke();
    } else {
      sel.forEach((el) => {
        const b = G.aabb(el);
        const p = store.toScreen(b.x, b.y);
        c.save();
        c.globalAlpha = 0.55;
        c.setLineDash([4, 3]);
        c.strokeRect(p.x, p.y, b.w * cam.scale, b.h * cam.scale);
        c.restore();
      });
      const box = G.aabbOf(sel);
      const p = store.toScreen(box.x, box.y);
      c.strokeRect(p.x, p.y, box.w * cam.scale, box.h * cam.scale);
    }

    if (store.state.ui.readOnly) { c.restore(); return; }

    // Handles
    const handles = R.selectionHandles();
    c.fillStyle = theme.dark ? '#20222a' : '#ffffff';
    c.lineWidth = 1.4;
    Object.keys(handles).forEach((k) => {
      const h = handles[k];
      c.beginPath();
      if (k === 'rot') {
        c.arc(h.x, h.y, 6, 0, Math.PI * 2);
      } else {
        c.rect(h.x - 4.5, h.y - 4.5, 9, 9);
      }
      c.fill();
      c.stroke();
    });
    c.restore();
  }

  /**
   * Where each locked element's padlock badge sits, in screen space.
   * Shared by the painter and the hit test so the badge you can see is
   * exactly the badge you can click.
   */
  const LOCK_BADGE_R = 8;
  R.lockBadges = function () {
    if (!R.overlay.showLocks) return [];
    return store.elements()
      .filter((el) => el.locked && !el.hidden)
      .map((el) => {
        const b = G.aabb(el);
        const a = store.toScreen(b.x, b.y);
        const z = store.toScreen(b.x + b.w, b.y + b.h);
        return { el, x: z.x - 9, y: a.y + 9, r: LOCK_BADGE_R };
      });
  };

  /** The locked element whose badge is under a screen point, if any. */
  R.lockBadgeAt = function (sx, sy) {
    const hit = R.lockBadges().find((b) => Math.hypot(sx - b.x, sy - b.y) <= b.r + 3);
    return hit ? hit.el : null;
  };

  /** A small padlock, drawn in screen space at (x, y). */
  function drawLockBadge(c, x, y, theme) {
    c.save();
    c.setLineDash([]);
    c.translate(x, y);
    c.fillStyle = theme.accent;
    c.strokeStyle = theme.accent;
    c.beginPath();
    c.arc(0, 0, 8, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = theme.dark ? '#16171b' : '#ffffff';
    c.lineWidth = 1.4;
    c.lineCap = 'round';
    // shackle
    c.beginPath();
    c.arc(0, -1.2, 2.6, Math.PI, 0);
    c.stroke();
    // body
    c.fillStyle = theme.dark ? '#16171b' : '#ffffff';
    c.fillRect(-3.4, -0.8, 6.8, 4.8);
    c.restore();
  }

  /** Handle positions in screen space for the current selection. */
  R.selectionHandles = function () {
    const sel = store.selected();
    if (!sel.length || store.state.ui.readOnly) return {};
    const cam = store.state.camera;

    if (sel.length === 1) {
      const el = sel[0];
      if (el.locked) return {};
      if (M.isLinear(el) && el.points && el.points.length <= 12 && el.type !== 'draw') {
        const out = {};
        const routed = el.route === 'elbow' || el.route === 'curve';
        el.points.forEach((p, i) => {
          // A routed connector is shaped by its ends only.
          if (routed && i !== 0 && i !== el.points.length - 1) return;
          const w = G.toWorld(el, p[0], p[1]);
          const s = store.toScreen(w.x, w.y);
          out['pt' + i] = { x: s.x, y: s.y, kind: 'point', index: i };
        });
        return out;
      }
      const pos = G.handlePositions(el);
      const out = {};
      Object.keys(pos).forEach((k) => {
        const s = store.toScreen(pos[k].x, pos[k].y);
        out[k] = { x: s.x, y: s.y, kind: k === 'rot' ? 'rotate' : 'resize' };
      });
      return out;
    }

    const box = G.aabbOf(sel);
    const p0 = store.toScreen(box.x, box.y);
    const p1 = store.toScreen(box.x + box.w, box.y + box.h);
    const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    return {
      nw: { x: p0.x, y: p0.y, kind: 'resize' },
      n: { x: mid.x, y: p0.y, kind: 'resize' },
      ne: { x: p1.x, y: p0.y, kind: 'resize' },
      e: { x: p1.x, y: mid.y, kind: 'resize' },
      se: { x: p1.x, y: p1.y, kind: 'resize' },
      s: { x: mid.x, y: p1.y, kind: 'resize' },
      sw: { x: p0.x, y: p1.y, kind: 'resize' },
      w: { x: p0.x, y: mid.y, kind: 'resize' },
      rot: { x: mid.x, y: p0.y - 26, kind: 'rotate' }
    };
  };

  function paintOverlays(c, theme) {
    const ov = R.overlay;
    const cam = store.state.camera;

    // Snap guides
    if (ov.guides && ov.guides.length) {
      c.save();
      c.strokeStyle = '#f06595';
      c.lineWidth = 1;
      c.setLineDash([4, 4]);
      ov.guides.forEach((g) => {
        c.beginPath();
        if (g.axis === 'v') {
          const s = store.toScreen(g.at, g.from);
          const e = store.toScreen(g.at, g.to);
          c.moveTo(Math.round(s.x) + 0.5, s.y - 12);
          c.lineTo(Math.round(e.x) + 0.5, e.y + 12);
        } else {
          const s = store.toScreen(g.from, g.at);
          const e = store.toScreen(g.to, g.at);
          c.moveTo(s.x - 12, Math.round(s.y) + 0.5);
          c.lineTo(e.x + 12, Math.round(e.y) + 0.5);
        }
        c.stroke();
      });
      c.restore();
    }

    // Hovered element (subtle, only with the select tool)
    if (ov.hoverId && store.state.tool === 'select' && store.state.selection.indexOf(ov.hoverId) < 0) {
      const el = store.byId(ov.hoverId);
      if (el) {
        const b = G.aabb(el);
        const p = store.toScreen(b.x, b.y);
        c.save();
        c.strokeStyle = U.withAlpha(theme.accent, 0.45);
        c.lineWidth = 1.25;
        c.strokeRect(p.x - 1, p.y - 1, b.w * cam.scale + 2, b.h * cam.scale + 2);
        c.restore();
      }
    }

    // Element an arrow is about to bind to
    if (ov.bindHighlight) {
      const el = store.byId(ov.bindHighlight);
      if (el) {
        const b = G.expand(G.aabb(el), 4);
        const p = store.toScreen(b.x, b.y);
        c.save();
        c.strokeStyle = '#2f9e44';
        c.lineWidth = 2;
        c.setLineDash([5, 4]);
        c.strokeRect(p.x, p.y, b.w * cam.scale, b.h * cam.scale);
        c.restore();
      }
    }

    // Marquee
    if (ov.marquee) {
      const m = ov.marquee;
      c.save();
      c.fillStyle = U.withAlpha(theme.accent, 0.10);
      c.strokeStyle = U.withAlpha(theme.accent, 0.75);
      c.lineWidth = 1;
      c.fillRect(m.x, m.y, m.w, m.h);
      c.strokeRect(Math.round(m.x) + 0.5, Math.round(m.y) + 0.5, Math.round(m.w), Math.round(m.h));
      c.restore();
    }

    // Locked elements.
    //
    // A locked element ignores clicks, drags and the eraser, so without a
    // marker it just reads as broken — "this line won't go away". Outline
    // every locked element and pin a padlock to its corner, so the reason is
    // on screen rather than something to work out.
    // Derived from the live tool rather than cached on a tool-change event:
    // setTool is a no-op when the tool has not changed, so a cached flag can
    // sit stale and the badges silently stop appearing.
    ov.showLocks = store.state.tool === 'eraser' || store.state.tool === 'select';
    if (ov.showLocks) {
      const locked = store.elements().filter((el) => el.locked && !el.hidden);
      if (locked.length) {
        c.save();
        c.strokeStyle = U.withAlpha(theme.accent, 0.55);
        c.lineWidth = 1;
        c.setLineDash([4, 4]);
        locked.forEach((el) => {
          const b = G.aabb(el);
          const a = store.toScreen(b.x, b.y);
          const z = store.toScreen(b.x + b.w, b.y + b.h);
          c.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5,
            Math.round(z.x - a.x), Math.round(z.y - a.y));
        });
        c.restore();
        // Badges on top of every outline, and positioned by the same helper
        // the hit test uses, so clicking one always finds it.
        c.save();
        R.lockBadges().forEach((b) => drawLockBadge(c, b.x, b.y, theme));
        c.restore();
      }
    }

    // Eraser cursor
    if (ov.eraserAt) {
      c.save();
      c.strokeStyle = theme.dark ? 'rgba(255,255,255,0.7)' : 'rgba(30,30,35,0.6)';
      c.fillStyle = theme.dark ? 'rgba(255,255,255,0.08)' : 'rgba(30,30,35,0.06)';
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(ov.eraserAt.x, ov.eraserAt.y, ov.eraserSize, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.restore();
    }

    // Laser trail (fades over ~1.1s)
    if (ov.laser.length) {
      const now = performance.now();
      ov.laser = ov.laser.filter((p) => now - p.t < 1100);
      if (ov.laser.length > 1) {
        c.save();
        c.lineCap = 'round';
        c.lineJoin = 'round';
        for (let i = 1; i < ov.laser.length; i++) {
          const a = ov.laser[i - 1], b = ov.laser[i];
          const age = (now - b.t) / 1100;
          const alpha = Math.max(0, 1 - age);
          const s1 = store.toScreen(a.x, a.y), s2 = store.toScreen(b.x, b.y);
          c.strokeStyle = `rgba(240,62,90,${alpha * 0.85})`;
          c.lineWidth = 4 + 4 * alpha;
          c.shadowColor = `rgba(240,62,90,${alpha})`;
          c.shadowBlur = 12;
          c.beginPath();
          c.moveTo(s1.x, s1.y);
          c.lineTo(s2.x, s2.y);
          c.stroke();
        }
        c.restore();
      }
      if (ov.laser.length) R.request();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Frame                                                              */
  /* ------------------------------------------------------------------ */

  R.draw = function () {
    if (!ctx) return;
    const theme = R.theme();
    R.setDarkPainting(theme.dark);
    const cam = store.state.camera;
    const page = store.page();
    const w = window.innerWidth, h = window.innerHeight;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R.paintBackground(ctx, cam, w, h, page, theme);

    // World transform
    ctx.save();
    ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, cam.x * dpr, cam.y * dpr);

    const view = G.expand(store.viewport(), 80 / cam.scale);
    const els = page.elements;
    R.setLod(cam.scale);
    let drawn = 0;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.hidden) continue;
      const b = G.aabb(el);
      if (!G.boxIntersects(view, G.expand(b, (el.strokeWidth || 2) + 24))) continue;
      // Below a pixel there is nothing to see; a dot keeps the board readable.
      if ((b.w * cam.scale < 1.2 && b.h * cam.scale < 1.2)) {
        ctx.fillStyle = el.fill && el.fill !== 'transparent' ? el.fill : R.adapt(el.stroke);
        ctx.fillRect(b.x, b.y, 1.2 / cam.scale, 1.2 / cam.scale);
        drawn++;
        continue;
      }
      R.paintElement(ctx, el, { exporting: false });
      drawn++;
    }

    // In-flight element (the one currently being drawn)
    if (R.overlay.draft) R.paintElement(ctx, R.overlay.draft, {});

    ctx.restore();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!store.state.ui.presenting) paintSelectionUI(ctx, theme);
    paintOverlays(ctx, theme);

    R.stats = { drawn, total: els.length };
    store.emit('painted', R.stats);
  };

  /* ------------------------------------------------------------------ */
  /*  Minimap                                                            */
  /* ------------------------------------------------------------------ */

  R.paintMinimap = function (mini) {
    if (!mini) return;
    const c = mini.getContext('2d');
    const w = mini.width, h = mini.height;
    const theme = R.theme();
    c.clearRect(0, 0, w, h);

    const els = store.elements();
    const view = store.viewport();
    const content = els.length ? G.aabbOf(els) : { x: view.x, y: view.y, w: view.w, h: view.h };
    const box = {
      x: Math.min(content.x, view.x), y: Math.min(content.y, view.y),
      w: 0, h: 0
    };
    box.w = Math.max(content.x + content.w, view.x + view.w) - box.x;
    box.h = Math.max(content.y + content.h, view.y + view.h) - box.y;
    const pad = Math.max(box.w, box.h) * 0.06 + 10;
    box.x -= pad; box.y -= pad; box.w += pad * 2; box.h += pad * 2;

    const scale = Math.min(w / box.w, h / box.h);
    const ox = (w - box.w * scale) / 2 - box.x * scale;
    const oy = (h - box.h * scale) / 2 - box.y * scale;

    c.save();
    c.translate(ox, oy);
    c.scale(scale, scale);
    els.forEach((el) => {
      const b = G.aabb(el);
      c.fillStyle = el.type === 'note' ? el.fill
        : (el.fill && el.fill !== 'transparent' ? el.fill : U.withAlpha(el.stroke || theme.ink, 0.75));
      c.globalAlpha = 0.9;
      if (M.isLinear(el)) {
        c.strokeStyle = el.stroke;
        c.lineWidth = Math.max(1 / scale, (el.strokeWidth || 2));
        const pts = G.linearPoints(el);
        c.beginPath();
        pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
        c.stroke();
      } else {
        c.fillRect(b.x, b.y, Math.max(b.w, 1 / scale), Math.max(b.h, 1 / scale));
      }
    });
    c.globalAlpha = 1;
    c.strokeStyle = theme.accent;
    c.lineWidth = 1.5 / scale;
    c.strokeRect(view.x, view.y, view.w, view.h);
    c.restore();

    R.minimapTransform = { scale, ox, oy };
  };

  IK.render = R;
})(window.IK = window.IK || {});
