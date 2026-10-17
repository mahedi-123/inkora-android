/* ------------------------------------------------------------------ *
 *  Small helpers used everywhere.                                      *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const U = {};

  /* ---- ids & randomness ------------------------------------------- */

  let counter = 0;
  U.uid = function (prefix) {
    counter += 1;
    return (prefix || 'e') + counter.toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  };

  /** Deterministic PRNG so a "hand drawn" shape looks the same every frame. */
  U.seededRandom = function (seed) {
    let h = 1779033703 ^ String(seed).length;
    for (let i = 0; i < String(seed).length; i++) {
      h = Math.imul(h ^ String(seed).charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return function () {
      a += 0x6d2b79f5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ---- maths ------------------------------------------------------- */

  U.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  U.round = (v, p) => Math.round(v * Math.pow(10, p || 0)) / Math.pow(10, p || 0);
  U.deg = (r) => (r * 180) / Math.PI;
  U.rad = (d) => (d * Math.PI) / 180;

  /** Rotate (x,y) around (cx,cy). */
  U.rotate = function (x, y, cx, cy, angle) {
    if (!angle) return { x, y };
    const c = Math.cos(angle), s = Math.sin(angle);
    const dx = x - cx, dy = y - cy;
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  };

  U.distToSegment = function (px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };

  /* ---- data -------------------------------------------------------- */

  U.clone = function (v) {
    if (typeof structuredClone === 'function') {
      try { return structuredClone(v); } catch (e) { /* falls through */ }
    }
    return JSON.parse(JSON.stringify(v));
  };

  U.debounce = function (fn, ms) {
    let t = null;
    const wrapped = function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), ms);
    };
    wrapped.cancel = () => clearTimeout(t);
    wrapped.flush = function () { clearTimeout(t); fn.apply(this, arguments); };
    return wrapped;
  };

  U.throttle = function (fn, ms) {
    let last = 0, timer = null, lastArgs = null;
    return function () {
      lastArgs = arguments;
      const now = Date.now();
      if (now - last >= ms) { last = now; fn.apply(this, lastArgs); }
      else if (!timer) {
        timer = setTimeout(() => { timer = null; last = Date.now(); fn.apply(this, lastArgs); }, ms - (now - last));
      }
    };
  };

  /* ---- colour ------------------------------------------------------ */

  /** '#rrggbb' + alpha 0..1 -> 'rgba(...)'. Accepts rgba()/named colours too. */
  U.withAlpha = function (color, alpha) {
    if (alpha >= 1) return color;
    if (!color) return color;
    if (color[0] === '#') {
      let hex = color.slice(1);
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
      if (hex.length === 8) hex = hex.slice(0, 6);
      const n = parseInt(hex, 16);
      if (Number.isNaN(n)) return color;
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
    }
    if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `,${alpha})`);
    return color;
  };

  /** Perceived luminance 0..1 — used to pick readable text on sticky notes. */
  U.luminance = function (color) {
    if (!color || color[0] !== '#') return 1;
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex.slice(0, 6), 16);
    if (Number.isNaN(n)) return 1;
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  U.readableInk = (bg) => (U.luminance(bg) > 0.45 ? '#171a20' : '#ffffff');

  /** Parse any hex form to [r,g,b], or null. */
  U.rgb = function (color) {
    if (!color || color[0] !== '#') return null;
    let hex = color.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length === 8) hex = hex.slice(0, 6);
    if (hex.length !== 6 || /[^0-9a-f]/i.test(hex)) return null;
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  /** True for black / white / grey — a colour with (almost) no hue. */
  U.isNeutral = function (color, tolerance) {
    const c = U.rgb(color);
    if (!c) return false;
    return (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) <= (tolerance === undefined ? 18 : tolerance);
  };

  /** '#abc', 'abcdef', '#ABCDEF' -> '#abcdef'; anything else -> null. */
  U.normalizeHex = function (input) {
    if (!input) return null;
    let v = String(input).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(v)) v = v.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(v)) return null;
    return '#' + v.toLowerCase();
  };

  /** WCAG contrast ratio between two colours, 1 (identical) to 21. */
  U.contrast = function (a, b) {
    const la = U.luminance(a), lb = U.luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  U.sameColor = function (a, b) {
    if (a === b) return true;
    const x = U.normalizeHex(a), y = U.normalizeHex(b);
    return !!x && !!y && x === y;
  };

  U.mix = function (a, b, t) {
    const parse = (c) => {
      let hex = c.replace('#', '');
      if (hex.length === 3) hex = hex.split('').map((x) => x + x).join('');
      const n = parseInt(hex, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const A = parse(a), B = parse(b);
    const to = (v) => Math.round(U.clamp(v, 0, 255)).toString(16).padStart(2, '0');
    return '#' + to(U.lerp(A[0], B[0], t)) + to(U.lerp(A[1], B[1], t)) + to(U.lerp(A[2], B[2], t));
  };

  /* ---- dom --------------------------------------------------------- */

  U.el = function (tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    (Array.isArray(children) ? children : children ? [children] : []).forEach((c) => {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };

  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /* ---- toast notifications ---------------------------------------- */

  let toastHost = null;
  U.toast = function (message, opts) {
    opts = opts || {};
    if (!toastHost) {
      toastHost = U.el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastHost);
    }
    const node = U.el('div', { class: 'toast' + (opts.tone ? ' toast--' + opts.tone : '') }, [
      opts.icon ? U.el('span', { class: 'toast__icon', html: opts.icon }) : null,
      U.el('span', { class: 'toast__msg', text: message })
    ]);
    if (opts.action) {
      node.appendChild(U.el('button', {
        class: 'toast__action', type: 'button', text: opts.action.label,
        onclick: () => { node.remove(); opts.action.run(); }
      }));
    }
    toastHost.appendChild(node);
    const life = opts.duration || (opts.action ? 6000 : 2600);
    setTimeout(() => {
      node.classList.add('toast--out');
      setTimeout(() => node.remove(), 260);
    }, life);
    return node;
  };

  /* ---- tiny event emitter ------------------------------------------ */

  U.emitter = function () {
    const map = new Map();
    return {
      on(evt, fn) {
        if (!map.has(evt)) map.set(evt, new Set());
        map.get(evt).add(fn);
        return () => map.get(evt).delete(fn);
      },
      off(evt, fn) { if (map.has(evt)) map.get(evt).delete(fn); },
      emit(evt, payload) {
        if (map.has(evt)) map.get(evt).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
      }
    };
  };

  /* ---- misc -------------------------------------------------------- */

  U.formatBytes = function (n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  };

  U.timeAgo = function (ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(ts).toLocaleDateString();
  };

  /** Case-insensitive subsequence match with a score — powers the palette. */
  U.fuzzy = function (needle, haystack) {
    if (!needle) return 0;
    const n = needle.toLowerCase(), h = haystack.toLowerCase();
    const direct = h.indexOf(n);
    if (direct === 0) return 1000;
    if (direct > 0) return 800 - direct;
    let score = 0, hi = 0, streak = 0;
    for (let i = 0; i < n.length; i++) {
      const idx = h.indexOf(n[i], hi);
      if (idx === -1) return -1;
      streak = idx === hi ? streak + 1 : 0;
      score += 10 + streak * 5 - Math.min(idx - hi, 10);
      hi = idx + 1;
    }
    return score;
  };

  U.isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  U.modKeyLabel = U.isMac ? '⌘' : 'Ctrl';

  /** 'Mod+Shift+K' -> '⌘⇧K' / 'Ctrl+Shift+K' */
  U.prettyKeys = function (accel) {
    if (!accel) return '';
    return accel
      .replace(/Mod/g, U.isMac ? '⌘' : 'Ctrl')
      .replace(/Shift/g, U.isMac ? '⇧' : 'Shift')
      .replace(/Alt/g, U.isMac ? '⌥' : 'Alt')
      .replace(/\+/g, U.isMac ? '' : '+');
  };

  IK.util = U;
})(window.IK = window.IK || {});
