/* ------------------------------------------------------------------ *
 *  Hand-drawn rendering.                                               *
 *                                                                      *
 *  Turns clean outlines into slightly wobbly, twice-drawn strokes and   *
 *  hatched fills — the "sketched on a whiteboard" look — deterministic  *
 *  per element so nothing jitters between frames.                       *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const U = IK.util;
  const S = {};

  /* ---- jittered strokes -------------------------------------------- */

  function offsetPoint(x, y, amp, rnd) {
    return [x + (rnd() - 0.5) * amp, y + (rnd() - 0.5) * amp];
  }

  /**
   * One wobbly pass over a polyline.
   * Segments are drawn as quadratic curves bowed slightly off-centre, which
   * is what makes a straight line look drawn by hand rather than by a plotter.
   */
  function pass(pts, amp, rnd, closed) {
    const out = [];
    const list = closed && pts.length > 2 ? pts.concat([pts[0]]) : pts;
    if (list.length < 2) return list.slice();

    out.push({ c: 'M', p: offsetPoint(list[0][0], list[0][1], amp, rnd) });
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const bow = Math.min(amp * 1.6, len * 0.08);
      const nx = len ? -(b[1] - a[1]) / len : 0;
      const ny = len ? (b[0] - a[0]) / len : 0;
      const sign = rnd() > 0.5 ? 1 : -1;
      out.push({
        c: 'Q',
        ctrl: [mx + nx * bow * sign, my + ny * bow * sign],
        p: offsetPoint(b[0], b[1], amp, rnd)
      });
    }
    return out;
  }

  /**
   * @param {number[][]} pts   polyline in local coordinates
   * @param {object} opts      {seed, roughness (0..2), closed}
   * @returns {Array[]}        1–2 path command lists
   */
  S.strokePasses = function (pts, opts) {
    const roughness = opts.roughness || 0;
    if (roughness <= 0 || pts.length < 2) {
      return [pts.map((p, i) => ({ c: i ? 'L' : 'M', p }))
        .concat(opts.closed && pts.length > 2 ? [{ c: 'Z' }] : [])];
    }
    const rnd = U.seededRandom(opts.seed || 1);
    const scale = Math.min(4, Math.max(0.6, roughness));
    const amp = 1.1 * scale;
    const passes = [pass(pts, amp, rnd, opts.closed)];
    if (roughness > 0.55) passes.push(pass(pts, amp * 1.35, rnd, opts.closed));
    return passes;
  };

  /** Replay a command list onto a 2D context. */
  S.trace = function (ctx, cmds) {
    ctx.beginPath();
    for (const cmd of cmds) {
      if (cmd.c === 'M') ctx.moveTo(cmd.p[0], cmd.p[1]);
      else if (cmd.c === 'L') ctx.lineTo(cmd.p[0], cmd.p[1]);
      else if (cmd.c === 'Q') ctx.quadraticCurveTo(cmd.ctrl[0], cmd.ctrl[1], cmd.p[0], cmd.p[1]);
      else if (cmd.c === 'C') ctx.bezierCurveTo(cmd.c1[0], cmd.c1[1], cmd.c2[0], cmd.c2[1], cmd.p[0], cmd.p[1]);
      else if (cmd.c === 'Z') ctx.closePath();
    }
  };

  /** Same command list as an SVG `d` attribute (used by the SVG exporter). */
  S.toSvgPath = function (cmds) {
    const n = (v) => Math.round(v * 100) / 100;
    let d = '';
    for (const cmd of cmds) {
      if (cmd.c === 'M') d += `M${n(cmd.p[0])} ${n(cmd.p[1])}`;
      else if (cmd.c === 'L') d += `L${n(cmd.p[0])} ${n(cmd.p[1])}`;
      else if (cmd.c === 'Q') d += `Q${n(cmd.ctrl[0])} ${n(cmd.ctrl[1])} ${n(cmd.p[0])} ${n(cmd.p[1])}`;
      else if (cmd.c === 'C') d += `C${n(cmd.c1[0])} ${n(cmd.c1[1])} ${n(cmd.c2[0])} ${n(cmd.c2[1])} ${n(cmd.p[0])} ${n(cmd.p[1])}`;
      else if (cmd.c === 'Z') d += 'Z';
    }
    return d;
  };

  /* ---- hatched fills ------------------------------------------------ */

  /**
   * Scanline hatching clipped to a polygon.
   * @returns {number[][][]} list of [[x1,y1],[x2,y2]] segments
   */
  S.hachure = function (poly, angleDeg, gap, seed) {
    const rnd = U.seededRandom(seed || 7);
    const a = U.rad(angleDeg === undefined ? -41 : angleDeg);
    const cos = Math.cos(-a), sin = Math.sin(-a);

    // Rotate into a space where the hatch lines are horizontal.
    const rot = poly.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rot.forEach(([x, y]) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    });

    const step = Math.max(3, gap || 8);
    const segs = [];
    const back = (x, y) => [x * cos + y * sin, -x * sin + y * cos];

    for (let y = minY + step * 0.5; y < maxY; y += step) {
      const xs = [];
      for (let i = 0, j = rot.length - 1; i < rot.length; j = i++) {
        const [x1, y1] = rot[j], [x2, y2] = rot[i];
        if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const jitter = (rnd() - 0.5) * 1.6;
        const a1 = back(xs[i] + Math.abs(jitter), y + jitter * 0.4);
        const a2 = back(xs[i + 1] - Math.abs(jitter), y - jitter * 0.4);
        if (Math.hypot(a2[0] - a1[0], a2[1] - a1[1]) > 1.5) segs.push([a1, a2]);
      }
    }
    return segs;
  };

  /* ---- cache -------------------------------------------------------- */

  /**
   * Generated geometry is cached on the element itself, in a `__`-prefixed
   * slot that never reaches a file. A shared Map needs an eviction policy,
   * and any cap smaller than the board thrashes: with 800 strokes on screen
   * a 900-entry cache spent every frame rebuilding what it had just thrown
   * away. Per-element storage is O(1), never evicts the wrong thing, and is
   * released with the element.
   */
  let generation = 0;

  /** Cache key: anything that changes the generated geometry. */
  S.key = function (el) {
    // Points are fingerprinted by their ends and middle rather than hashed in
    // full: a flip, an endpoint drag or a split all move at least one of them,
    // and the cost stays constant per element per frame.
    let pk = 0;
    const pts = el.points;
    if (pts && pts.length) {
      const a = pts[0], z = pts[pts.length - 1], m = pts[pts.length >> 1];
      pk = pts.length + '/' + Math.round(a[0] * 10) + ',' + Math.round(a[1] * 10) + '/' +
        Math.round(m[0] * 10) + ',' + Math.round(m[1] * 10) + '/' +
        Math.round(z[0] * 10) + ',' + Math.round(z[1] * 10);
    }
    return generation + '|' + el.seed + '|' + Math.round(el.w * 10) + '|' + Math.round(el.h * 10) + '|' +
      el.sketch + '|' + el.type + '|' + el.roundness + '|' + el.fillStyle + '|' +
      el.strokeWidth + '|' + (el.flipX ? 1 : 0) + (el.flipY ? 1 : 0) + '|' + el.taper + '|' + pk;
  };

  /**
   * @param {object} el          the element to cache against
   * @param {function} build     produces the value when the key changes
   * @param {string} [slot]      lets one element hold two cached things
   */
  S.cached = function (el, build, slot) {
    const field = slot || '__geom';
    const k = S.key(el);
    const hit = el[field];
    if (hit && hit.k === k) return hit.v;
    const v = build();
    el[field] = { k, v };
    return v;
  };

  /** Invalidate everything (used when the whole document is replaced). */
  S.clearCache = function () { generation += 1; };

  /* ---- pressure-sensitive ink -------------------------------------- */

  /**
   * Build a filled outline for a pressure-varying stroke.
   * Walks up one side of the polyline and back down the other, offsetting by
   * half the (pressure-scaled) width — the same trick perfect-freehand uses.
   */
  S.inkOutline = function (points, pressures, width, opts) {
    opts = opts || {};
    const n = points.length;
    if (n < 2) {
      const r = width / 2;
      const [x, y] = points[0] || [0, 0];
      const circle = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        circle.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
      }
      return circle;
    }

    const left = [], right = [];
    const taper = opts.taper === undefined ? true : opts.taper;

    for (let i = 0; i < n; i++) {
      const p = points[i];
      const prev = points[i - 1] || p;
      const next = points[i + 1] || p;
      let dx = next[0] - prev[0], dy = next[1] - prev[1];
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;

      let pressure = pressures && pressures[i] !== undefined ? pressures[i] : 0.5;
      // Ends taper so strokes look like ink, not like ribbons.
      if (taper) {
        const fromStart = i / Math.max(1, n - 1);
        const edge = Math.min(fromStart, 1 - fromStart);
        pressure *= U.clamp(0.35 + edge * 6, 0.35, 1);
      }
      const r = Math.max(0.35, (width / 2) * (0.55 + pressure * 0.9));
      left.push([p[0] - dy * r, p[1] + dx * r]);
      right.push([p[0] + dy * r, p[1] - dx * r]);
    }
    return left.concat(right.reverse());
  };

  IK.sketch = S;
})(window.IK = window.IK || {});
