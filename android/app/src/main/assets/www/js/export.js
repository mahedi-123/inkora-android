/* ------------------------------------------------------------------ *
 *  Exporters — PNG, JPEG, SVG, PDF, clipboard, and element copy/paste. *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const U = IK.util;
  const M = IK.model;
  const G = IK.geom;
  const R = IK.render;
  const store = IK.store;
  const BRAND = IK.BRAND;

  const X = {};
  const CLIP_PREFIX = 'inkora/clipboard:';

  /* ------------------------------------------------------------------ */
  /*  Raster                                                             */
  /* ------------------------------------------------------------------ */

  function targetElements(opts) {
    if (opts.elements) return opts.elements;
    if (opts.selectionOnly && store.state.selection.length) return store.selected();
    if (opts.frame) {
      const f = opts.frame;
      const box = G.aabb(f);
      return store.elements().filter((el) => el.id !== f.id && G.boxIntersects(box, G.aabb(el)));
    }
    return store.elements().filter((el) => el.type !== 'comment' || opts.includeComments);
  }

  /**
   * Draw a set of elements onto a fresh canvas.
   * @returns {{canvas:HTMLCanvasElement, box:object}}
   */
  X.renderToCanvas = function (opts) {
    opts = opts || {};
    R.setDarkPainting(R.theme().dark && !opts.forceLight);
    const els = targetElements(opts);
    const scale = opts.scale || 1;
    const pad = opts.padding === undefined ? 32 : opts.padding;
    const theme = R.theme();

    let box = opts.frame ? G.aabb(opts.frame) : (els.length ? G.aabbOf(els) : { x: 0, y: 0, w: 1200, h: 800 });
    if (!opts.frame) box = G.expand(box, pad);

    const w = Math.max(1, Math.ceil(box.w * scale));
    const h = Math.max(1, Math.ceil(box.h * scale));
    const canvas = document.createElement('canvas');
    // Guard against absurd sizes that would blow the GPU limit.
    const MAX = 12000;
    const clampScale = Math.min(1, MAX / Math.max(w, h));
    canvas.width = Math.max(1, Math.floor(w * clampScale));
    canvas.height = Math.max(1, Math.floor(h * clampScale));

    const c = canvas.getContext('2d');
    const s = scale * clampScale;

    if (!opts.transparent) {
      c.fillStyle = opts.background || store.page().canvasColor || theme.canvas;
      c.fillRect(0, 0, canvas.width, canvas.height);
      if (opts.withBackgroundPattern) {
        R.paintBackground(c, { x: -box.x * s, y: -box.y * s, scale: s },
          canvas.width, canvas.height, store.page(), theme);
      }
    }

    c.save();
    c.scale(s, s);
    c.translate(-box.x, -box.y);
    els.forEach((el) => {
      if (el.hidden) return;
      if (opts.frame && el.type === 'frame') return;
      R.paintElement(c, el, { exporting: true, includeComments: opts.includeComments });
    });
    c.restore();
    return { canvas, box, scale: s };
  };

  X.toPNG = function (opts) {
    const { canvas } = X.renderToCanvas(opts || {});
    return canvas.toDataURL('image/png');
  };

  X.toJPEG = function (opts) {
    const o = Object.assign({}, opts || {}, { transparent: false });
    const { canvas } = X.renderToCanvas(o);
    return canvas.toDataURL('image/jpeg', (o.quality || 0.92));
  };

  X.toBlob = function (opts, mime) {
    const { canvas } = X.renderToCanvas(opts || {});
    return new Promise((resolve) => canvas.toBlob(resolve, mime || 'image/png'));
  };

  /* ------------------------------------------------------------------ */
  /*  SVG                                                                */
  /* ------------------------------------------------------------------ */

  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const adapt = (c) => R.adapt(c);

  function svgStrokeAttrs(el) {
    const dash = el.strokeStyle === 'dashed'
      ? `stroke-dasharray="${(el.strokeWidth || 2) * 3.2} ${(el.strokeWidth || 2) * 2.4}"`
      : el.strokeStyle === 'dotted'
        ? `stroke-dasharray="0.1 ${(el.strokeWidth || 2) * 2.6}"` : '';
    return `stroke="${esc(adapt(el.stroke))}" stroke-width="${el.strokeWidth || 2}" ` +
      `stroke-linecap="round" stroke-linejoin="round" ${dash}`;
  }

  function svgTransform(el) {
    if (!el.angle) return `translate(${U.round(el.x, 2)} ${U.round(el.y, 2)})`;
    const cx = el.w / 2, cy = el.h / 2;
    return `translate(${U.round(el.x, 2)} ${U.round(el.y, 2)}) rotate(${U.round(U.deg(el.angle), 2)} ${U.round(cx, 2)} ${U.round(cy, 2)})`;
  }

  function svgTextBlock(el, defaultColor) {
    const layout = R.layoutText(el);
    if (!layout) return '';
    const color = el.textColor ||
      (el.type === 'note' ? U.readableInk(el.fill) : (el.stroke !== 'transparent' ? el.stroke : defaultColor));
    const pad = layout.pad;
    const family = (M.FONTS[el.fontFamily] || M.FONTS.sans).replace(/"/g, "'");
    const boxW = Math.abs(el.w) - pad * 2;
    const anchor = el.textAlign === 'center' ? 'middle' : el.textAlign === 'right' ? 'end' : 'start';
    const xPos = el.textAlign === 'center' ? pad + boxW / 2 : el.textAlign === 'right' ? pad + boxW : pad;
    let y = pad;
    if (el.vAlign === 'middle') y = (Math.abs(el.h) - layout.height) / 2;
    y += layout.size * 0.78;
    let out = `<text font-family="${esc(family)}" font-size="${U.round(layout.size, 2)}" ` +
      `font-weight="${el.fontWeight || 400}" fill="${esc(el.type === 'note' ? color : adapt(color))}" text-anchor="${anchor}">`;
    layout.lines.forEach((line, i) => {
      out += `<tspan x="${U.round(xPos, 2)}" y="${U.round(y + i * layout.lineHeight, 2)}">${esc(line)}</tspan>`;
    });
    return out + '</text>';
  }

  function svgElement(el, theme) {
    if (el.hidden) return '';
    const open = `<g transform="${svgTransform(el)}" opacity="${el.opacity === undefined ? 1 : el.opacity}">`;
    let body = '';

    if (el.type === 'image') {
      body = `<image href="${esc(el.src)}" x="0" y="0" width="${U.round(el.w, 2)}" height="${U.round(el.h, 2)}" preserveAspectRatio="none"/>`;
    } else if (el.type === 'draw') {
      const pts = el.points || [];
      if (el.brush === 'marker') {
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${U.round(p[0], 2)} ${U.round(p[1], 2)}`).join('');
        // The wrapping <g> already carries el.opacity; a second opacity here
        // would multiply the two and export a stroke half as strong as the
        // one on screen. Match the canvas blend mode instead.
        body = `<path d="${d}" fill="none" stroke="${esc(adapt(el.stroke))}" stroke-width="${(el.strokeWidth || 2) * 3.4}" stroke-linecap="round" stroke-linejoin="round" style="mix-blend-mode:${R.markerBlend()}"/>`;
      } else {
        const outline = IK.sketch.inkOutline(pts, el.pressures, el.strokeWidth || 2, { taper: el.taper !== false });
        const d = outline.map((p, i) => `${i ? 'L' : 'M'}${U.round(p[0], 2)} ${U.round(p[1], 2)}`).join('') + 'Z';
        body = `<path d="${d}" fill="${esc(adapt(el.stroke))}" stroke="none"/>`;
      }
    } else if (M.isLinear(el)) {
      const pts = el.points || [];
      let d;
      if (el.sketch > 0) {
        d = IK.sketch.strokePasses(pts, { seed: el.seed, roughness: el.sketch, closed: false })
          .map(IK.sketch.toSvgPath).join(' ');
      } else if (el.curve && pts.length > 2) {
        // Same Catmull-Rom curve the canvas paints.
        const r2 = (v) => U.round(v, 2);
        d = `M${r2(pts[0][0])} ${r2(pts[0][1])}` + G.smoothPath(pts).map((c) => (c.c === 'C'
          ? `C${r2(c.c1[0])} ${r2(c.c1[1])} ${r2(c.c2[0])} ${r2(c.c2[1])} ${r2(c.p[0])} ${r2(c.p[1])}`
          : `L${r2(c.p[0])} ${r2(c.p[1])}`)).join('');
      } else {
        d = pts.map((p, i) => `${i ? 'L' : 'M'}${U.round(p[0], 2)} ${U.round(p[1], 2)}`).join('');
      }
      body = `<path d="${d}" fill="none" ${svgStrokeAttrs(el)}/>`;
      const head = (kind, x, y, angle) => {
        if (!kind || kind === 'none') return '';
        const size = Math.max(9, (el.strokeWidth || 2) * 3.6);
        const t = `translate(${U.round(x, 2)} ${U.round(y, 2)}) rotate(${U.round(U.deg(angle), 2)})`;
        if (kind === 'dot') return `<circle cx="0" cy="0" r="${size * 0.42}" fill="${esc(adapt(el.stroke))}" transform="${t}"/>`;
        if (kind === 'triangle') return `<path d="M0 0L${-size} ${-size * 0.42}L${-size} ${size * 0.42}Z" fill="${esc(adapt(el.stroke))}" transform="${t}"/>`;
        return `<path d="M${-size} ${-size * 0.55}L0 0L${-size} ${size * 0.55}" fill="none" ${svgStrokeAttrs(el)} transform="${t}"/>`;
      };
      if (pts.length >= 2) {
        const a = pts[0], a2 = pts[1], z = pts[pts.length - 1], z2 = pts[pts.length - 2];
        body += head(el.arrowEnd, z[0], z[1], Math.atan2(z[1] - z2[1], z[0] - z2[0]));
        body += head(el.arrowStart, a[0], a[1], Math.atan2(a[1] - a2[1], a[0] - a2[0]));
      }
      if (M.textOf(el)) body += svgTextBlock({ ...el, x: 0, y: 0, type: 'text' }, theme.ink);
    } else if (el.type === 'frame') {
      body = `<rect width="${U.round(el.w, 2)}" height="${U.round(el.h, 2)}" fill="none" stroke="${esc(theme.frame)}" stroke-width="1.25"/>`;
    } else {
      const subs = G.outline(el);
      const fillCol = el.fill && el.fill !== 'transparent' && el.fillStyle !== 'none' ? adapt(el.fill) : 'none';
      if (el.type === 'ellipse' && !el.sketch) {
        body = `<ellipse cx="${U.round(el.w / 2, 2)}" cy="${U.round(el.h / 2, 2)}" rx="${U.round(Math.abs(el.w) / 2, 2)}" ry="${U.round(Math.abs(el.h) / 2, 2)}" fill="${esc(fillCol)}" ${svgStrokeAttrs(el)}/>`;
      } else if ((el.type === 'rect' || el.type === 'note') && !el.sketch) {
        const r = el.type === 'note' ? 10 : Math.min(Math.abs(el.w), Math.abs(el.h)) * 0.18 * (el.roundness || 0) * 2;
        body = `<rect width="${U.round(el.w, 2)}" height="${U.round(el.h, 2)}" rx="${U.round(r, 2)}" fill="${esc(fillCol)}" ${el.stroke === 'transparent' ? 'stroke="none"' : svgStrokeAttrs(el)}/>`;
      } else {
        const d = subs.map((s) => {
          if (el.sketch > 0) {
            return IK.sketch.strokePasses(s.pts, { seed: el.seed, roughness: el.sketch, closed: s.closed })
              .map(IK.sketch.toSvgPath).join(' ');
          }
          return s.pts.map((p, i) => `${i ? 'L' : 'M'}${U.round(p[0], 2)} ${U.round(p[1], 2)}`).join('') + (s.closed ? 'Z' : '');
        }).join(' ');
        body = `<path d="${d}" fill="${esc(fillCol)}" fill-rule="evenodd" ${el.stroke === 'transparent' ? 'stroke="none"' : svgStrokeAttrs(el)}/>`;
      }
      if (M.textOf(el)) body += svgTextBlock(el, theme.ink);
    }

    if (el.type === 'text' || el.type === 'note') {
      if (el.type === 'text') body = svgTextBlock(el, theme.ink);
      else body += svgTextBlock(el, theme.ink);
    }
    return open + body + '</g>';
  }

  X.toSVG = function (opts) {
    opts = opts || {};
    R.setDarkPainting(R.theme().dark && !opts.forceLight);
    const els = targetElements(opts);
    const theme = R.theme();
    const pad = opts.padding === undefined ? 32 : opts.padding;
    let box = opts.frame ? G.aabb(opts.frame) : (els.length ? G.aabbOf(els) : { x: 0, y: 0, w: 1200, h: 800 });
    if (!opts.frame) box = G.expand(box, pad);

    const bg = opts.transparent ? '' :
      `<rect x="${U.round(box.x, 2)}" y="${U.round(box.y, 2)}" width="${U.round(box.w, 2)}" height="${U.round(box.h, 2)}" fill="${esc(opts.background || store.page().canvasColor || theme.canvas)}"/>`;

    const body = els.filter((el) => el.type !== 'comment' || opts.includeComments)
      .map((el) => svgElement(el, theme)).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${U.round(box.w, 2)}" height="${U.round(box.h, 2)}"
     viewBox="${U.round(box.x, 2)} ${U.round(box.y, 2)} ${U.round(box.w, 2)} ${U.round(box.h, 2)}">
  <!-- Made with ${BRAND.name} ${BRAND.version} -->
  ${bg}
${body}
</svg>`;
  };

  /* ------------------------------------------------------------------ */
  /*  PDF                                                                */
  /*                                                                      */
  /*  A very small PDF writer: one page per image, images embedded as     *
  /*  Flate-compressed RGB when the browser can deflate, else as JPEG.    */
  /* ------------------------------------------------------------------ */

  async function deflate(bytes) {
    if (typeof CompressionStream !== 'function') return null;
    try {
      const cs = new CompressionStream('deflate');
      const stream = new Blob([bytes]).stream().pipeThrough(cs);
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) { return null; }
  }

  function latin1(bytes) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return s;
  }

  async function pageImage(canvas) {
    const w = canvas.width, h = canvas.height;
    const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2];
    }
    const flate = await deflate(rgb);
    if (flate) return { w, h, bytes: flate, filter: '/FlateDecode' };
    const jpeg = canvas.toDataURL('image/jpeg', 0.94).split(',')[1];
    const bin = atob(jpeg);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { w, h, bytes, filter: '/DCTDecode' };
  }

  /**
   * @param {Array<HTMLCanvasElement>} canvases one per page
   * @returns {Promise<Blob>}
   */
  X.canvasesToPDF = async function (canvases, meta) {
    const images = [];
    for (const cv of canvases) images.push(await pageImage(cv));

    const objects = [];
    const push = (str) => { objects.push(str); return objects.length; }; // 1-based ids

    const catalogId = 1, pagesId = 2;
    objects.push('', ''); // reserve 1 and 2

    const kids = [];
    images.forEach((img, i) => {
      const pw = img.w * 0.72, ph = img.h * 0.72; // ~100dpi -> points
      const imgId = objects.length + 1;
      objects.push(
        `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${img.filter} /Length ${img.bytes.length} >>\nstream\n` +
        latin1(img.bytes) + '\nendstream'
      );
      const contentStr = `q ${pw.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm /Im0 Do Q`;
      const contentId = objects.length + 1;
      objects.push(`<< /Length ${contentStr.length} >>\nstream\n${contentStr}\nendstream`);
      const pageId = objects.length + 1;
      objects.push(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] ` +
        `/Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`
      );
      kids.push(pageId);
    });

    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] >>`;

    const infoId = objects.length + 1;
    // PDF literal strings here are written byte-for-byte, so keep the title
    // to printable ASCII rather than emitting mangled multi-byte characters.
    const title = String((meta && meta.title) || 'Board').replace(/[^\x20-\x7e]/g, '').trim() || 'Board';
    objects.push(`<< /Title (${title.replace(/[()\\]/g, '')}) /Producer (${BRAND.name} ${BRAND.version}) >>`);

    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    objects.forEach((obj, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach((off) => { out += String(off).padStart(10, '0') + ' 00000 n \n'; });
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF`;

    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  };

  /**
   * @param {'board'|'pages'|'frames'} mode
   */
  X.toPDF = async function (mode, opts) {
    opts = Object.assign({ scale: 2, padding: 40 }, opts || {});
    const canvases = [];
    const doc = store.doc();

    if (mode === 'pages') {
      const active = doc.activePage;
      for (let i = 0; i < doc.pages.length; i++) {
        doc.activePage = i;
        const els = store.elements();
        if (!els.length) continue;
        canvases.push(X.renderToCanvas(Object.assign({}, opts, { elements: els })).canvas);
      }
      doc.activePage = active;
    } else if (mode === 'frames') {
      const frames = store.elements().filter((el) => el.type === 'frame')
        .sort((a, b) => (a.y - b.y) || (a.x - b.x));
      for (const f of frames) canvases.push(X.renderToCanvas(Object.assign({}, opts, { frame: f, padding: 0 })).canvas);
      if (!frames.length) canvases.push(X.renderToCanvas(opts).canvas);
    } else {
      canvases.push(X.renderToCanvas(opts).canvas);
    }
    if (!canvases.length) canvases.push(X.renderToCanvas(opts).canvas);
    return X.canvasesToPDF(canvases, { title: store.documentName() });
  };

  /* ------------------------------------------------------------------ */
  /*  Clipboard: elements                                                */
  /* ------------------------------------------------------------------ */

  X.copySelection = async function (cut) {
    const sel = store.selected();
    if (!sel.length) return false;
    const payload = CLIP_PREFIX + JSON.stringify({
      version: 2,
      elements: sel.map(M.cleanElement)
    });
    await IK.platform.writeClipboardText(payload);
    X._localClipboard = payload;
    if (cut) store.remove(sel.map((e) => e.id));
    return true;
  };

  X.pasteText = function (text, atScreen) {
    if (!text) return false;
    let json = null;
    if (text.indexOf(CLIP_PREFIX) === 0) {
      try { json = JSON.parse(text.slice(CLIP_PREFIX.length)); } catch (e) { json = null; }
    }
    if (!json) {
      // Plain text becomes a text element (or a sticky note if it's long).
      const w = store.toWorld(
        atScreen ? atScreen.x : window.innerWidth / 2,
        atScreen ? atScreen.y : window.innerHeight / 2
      );
      const long = text.length > 120;
      const el = M.create(long ? 'note' : 'text', {
        x: w.x - (long ? 104 : 0), y: w.y - (long ? 104 : 0),
        text: text.trim(),
        fill: long ? (store.state.style.noteColor || M.PALETTE.note[0]) : 'transparent',
        stroke: long ? 'transparent' : store.state.style.stroke,
        textAlign: 'left', vAlign: 'top'
      }, store.state.style);
      if (!long) {
        const size = IK.render.measureTextBlock(Object.assign({}, el, { w: 100000, h: 100000 }));
        el.w = Math.max(24, Math.min(size.w + 8, 900));
        el.h = Math.max(el.fontSize * 1.32, IK.render.measureTextBlock(el).h);
      }
      store.add(el, { select: true });
      return true;
    }

    const els = (json.elements || []).map(M.upgradeElement);
    if (!els.length) return false;
    const box = G.aabbOf(els);
    const target = store.toWorld(
      atScreen ? atScreen.x : window.innerWidth / 2,
      atScreen ? atScreen.y : window.innerHeight / 2
    );
    const dx = target.x - (box.x + box.w / 2);
    const dy = target.y - (box.y + box.h / 2);
    const copies = IK.tools.cloneElements(els, dx, dy).map(M.upgradeElement);
    store.addMany(copies, { select: true });
    return true;
  };

  X.duplicateSelection = function (offset) {
    const sel = store.selected();
    if (!sel.length) return;
    const d = offset === undefined ? 22 : offset;
    const copies = IK.tools.cloneElements(sel, d, d);
    store.addMany(copies, { select: true });
  };

  IK.exporters = X;
})(window.IK = window.IK || {});
