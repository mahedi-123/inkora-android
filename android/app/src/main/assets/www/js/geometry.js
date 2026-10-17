/* ------------------------------------------------------------------ *
 *  Geometry — bounds, outlines, hit-testing, resizing, snapping,       *
 *  and the anchor maths that keeps arrows glued to shapes.             *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const U = IK.util;
  const M = IK.model;
  const G = {};

  /* ------------------------------------------------------------------ */
  /*  Bounds                                                             */
  /* ------------------------------------------------------------------ */

  /** Unrotated box in world space. */
  G.box = function (el) {
    return { x: el.x, y: el.y, w: el.w, h: el.h };
  };

  G.center = function (el) {
    return { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  };

  /** Four corners in world space, honouring rotation. */
  G.corners = function (el) {
    const c = G.center(el);
    const pts = [
      [el.x, el.y], [el.x + el.w, el.y],
      [el.x + el.w, el.y + el.h], [el.x, el.y + el.h]
    ];
    return pts.map(([x, y]) => U.rotate(x, y, c.x, c.y, el.angle || 0));
  };

  /** Axis-aligned bounding box that contains the (possibly rotated) element. */
  G.aabb = function (el) {
    if (!el.angle) {
      const b = { x: Math.min(el.x, el.x + el.w), y: Math.min(el.y, el.y + el.h), w: Math.abs(el.w), h: Math.abs(el.h) };
      return b;
    }
    const cs = G.corners(el);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    cs.forEach((p) => {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  /** Bounding box of many elements (world, axis-aligned). */
  G.aabbOf = function (elements) {
    if (!elements || !elements.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elements) {
      const b = G.aabb(el);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  G.expand = function (b, pad) {
    return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  };

  G.boxIntersects = function (a, b) {
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  };

  G.boxContains = function (outer, inner) {
    return inner.x >= outer.x && inner.y >= outer.y &&
      inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
  };

  G.pointInBox = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

  /* ------------------------------------------------------------------ */
  /*  Local <-> world                                                    */
  /* ------------------------------------------------------------------ */

  /** World point -> element-local coordinates (origin at el.x/el.y, unrotated). */
  G.toLocal = function (el, x, y) {
    const c = G.center(el);
    const p = U.rotate(x, y, c.x, c.y, -(el.angle || 0));
    return { x: p.x - el.x, y: p.y - el.y };
  };

  /** Element-local -> world. */
  G.toWorld = function (el, lx, ly) {
    const c = G.center(el);
    return U.rotate(el.x + lx, el.y + ly, c.x, c.y, el.angle || 0);
  };

  /* ------------------------------------------------------------------ */
  /*  Outlines (local space, origin 0,0, size w x h)                     */
  /* ------------------------------------------------------------------ */

  function ellipsePoints(w, h, steps) {
    const rx = w / 2, ry = h / 2, out = [];
    const n = steps || Math.max(24, Math.min(96, Math.round((Math.abs(w) + Math.abs(h)) / 6)));
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      out.push([rx + rx * Math.cos(t), ry + ry * Math.sin(t)]);
    }
    return out;
  }

  function roundRectPoints(w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    if (rr < 0.5) return [[0, 0], [w, 0], [w, h], [0, h]];
    const pts = [];
    const arc = (cx, cy, from, to) => {
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const a = from + (to - from) * (i / steps);
        pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
      }
    };
    arc(rr, rr, Math.PI, Math.PI * 1.5);
    arc(w - rr, rr, Math.PI * 1.5, Math.PI * 2);
    arc(w - rr, h - rr, 0, Math.PI * 0.5);
    arc(rr, h - rr, Math.PI * 0.5, Math.PI);
    return pts;
  }

  /**
   * Outline of a shape in local coordinates.
   * @returns {{pts:number[][], closed:boolean}[]} one or more sub-paths
   */
  G.outline = function (el) {
    const subs = rawOutline(el);
    // Mirrored shapes (triangle, parallelogram, bubble, cloud…) are stored
    // as flags rather than by rewriting the geometry, so a flip is exact
    // and survives a resize.
    if (!el.flipX && !el.flipY) return subs;
    const w = el.w, h = el.h;
    return subs.map((sub) => ({
      closed: sub.closed,
      pts: sub.pts.map(([x, y]) => [el.flipX ? w - x : x, el.flipY ? h - y : y])
    }));
  };

  function rawOutline(el) {
    const w = el.w, h = el.h;
    const R = (el.roundness || 0);
    switch (el.type) {
      case 'rect':
        return [{ pts: roundRectPoints(w, h, Math.min(Math.abs(w), Math.abs(h)) * 0.18 * R * 2), closed: true }];
      case 'note':
        return [{ pts: roundRectPoints(w, h, 8), closed: true }];
      case 'frame':
        return [{ pts: [[0, 0], [w, 0], [w, h], [0, h]], closed: true }];
      case 'image':
        return [{ pts: roundRectPoints(w, h, el.cornerRadius || 0), closed: true }];
      case 'ellipse':
        return [{ pts: ellipsePoints(w, h), closed: true }];
      case 'diamond':
        return [{ pts: [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], closed: true }];
      case 'triangle':
        return [{ pts: [[w / 2, 0], [w, h], [0, h]], closed: true }];
      case 'parallelogram':
        return [{ pts: [[w * 0.22, 0], [w, 0], [w * 0.78, h], [0, h]], closed: true }];
      case 'hexagon':
        return [{ pts: [[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]], closed: true }];
      case 'star': {
        const pts = [];
        const cx = w / 2, cy = h / 2;
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rx = (i % 2 ? 0.42 : 1) * (w / 2);
          const ry = (i % 2 ? 0.42 : 1) * (h / 2);
          pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
        }
        return [{ pts, closed: true }];
      }
      case 'cylinder': {
        const ry = Math.min(Math.abs(h) * 0.16, Math.abs(w) * 0.28);
        const body = [];
        // right side down, bottom arc, left side up, top arc
        for (let i = 0; i <= 12; i++) {
          const a = -Math.PI / 2 + (i / 12) * Math.PI; // top ellipse right half
          body.push([w / 2 + (w / 2) * Math.cos(a), ry + ry * Math.sin(a)]);
        }
        body.push([w, h - ry]);
        for (let i = 0; i <= 12; i++) {
          const a = (i / 12) * Math.PI;
          body.push([w / 2 + (w / 2) * Math.cos(a), h - ry + ry * Math.sin(a)]);
        }
        body.push([0, ry]);
        const cap = [];
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          cap.push([w / 2 + (w / 2) * Math.cos(a), ry + ry * Math.sin(a)]);
        }
        return [{ pts: body, closed: true }, { pts: cap, closed: true }];
      }
      case 'cloud': {
        const pts = [];
        const bumps = [
          [0.16, 0.68, 0.17], [0.30, 0.40, 0.22], [0.53, 0.34, 0.25],
          [0.76, 0.46, 0.20], [0.86, 0.70, 0.16]
        ];
        bumps.forEach(([bx, by, br]) => {
          for (let i = 0; i <= 14; i++) {
            const a = Math.PI * (1.15 + (i / 14) * 1.0);
            pts.push([w * bx + w * br * Math.cos(a), h * by + h * br * 1.5 * Math.sin(a)]);
          }
        });
        pts.push([w * 0.92, h * 0.86], [w * 0.1, h * 0.86]);
        return [{ pts, closed: true }];
      }
      case 'bubble': {
        const tailY = h * 0.78;
        const body = roundRectPoints(w, tailY, Math.min(18, Math.abs(w) * 0.12));
        // splice a tail into the bottom edge
        const out = [];
        for (const p of body) {
          out.push(p);
          if (Math.abs(p[1] - tailY) < 0.01 && p[0] < w * 0.42 && p[0] > w * 0.2) {
            out.push([w * 0.3, h], [w * 0.36, tailY]);
          }
        }
        return [{ pts: out, closed: true }];
      }
      default:
        return [{ pts: [[0, 0], [w, 0], [w, h], [0, h]], closed: true }];
    }
  }

  /** Trace an element's crisp path into a canvas/Path2D-like context. */
  G.tracePath = function (ctx, el) {
    const w = el.w, h = el.h;
    if (el.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
      return;
    }
    if (el.type === 'rect' || el.type === 'note' || el.type === 'image' || el.type === 'frame') {
      const r = el.type === 'note' ? 10
        : el.type === 'image' ? (el.cornerRadius || 0)
          : el.type === 'frame' ? 4
            : Math.min(Math.abs(w), Math.abs(h)) * 0.18 * (el.roundness || 0) * 2;
      ctx.beginPath();
      if (ctx.roundRect && r > 0.5) ctx.roundRect(0, 0, w, h, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
      else ctx.rect(0, 0, w, h);
      return;
    }
    const subs = G.outline(el);
    ctx.beginPath();
    subs.forEach((sub) => {
      sub.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
      if (sub.closed) ctx.closePath();
    });
  };

  /* ------------------------------------------------------------------ */
  /*  Linear elements                                                    */
  /* ------------------------------------------------------------------ */

  /** Absolute (world) points of a linear element, honouring rotation. */
  G.linearPoints = function (el) {
    return (el.points || []).map((p) => {
      const q = G.toWorld(el, p[0], p[1]);
      return [q.x, q.y];
    });
  };

  /** Re-fit x/y/w/h to the point cloud, keeping points local & positive. */
  G.normalizeLinear = function (el) {
    const pts = el.points || [];
    if (!pts.length) return el;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(([x, y]) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    });
    el.x += minX; el.y += minY;
    el.w = Math.max(maxX - minX, 0.0001);
    el.h = Math.max(maxY - minY, 0.0001);
    el.points = pts.map(([x, y]) => [x - minX, y - minY]);
    return el;
  };

  /** Catmull–Rom -> cubic bezier, used for smooth ink and curved arrows. */
  G.smoothPath = function (pts) {
    if (pts.length < 3) return pts.map((p) => ({ c: 'L', p }));
    const out = [{ c: 'M', p: pts[0] }];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      out.push({
        c: 'C',
        c1: [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
        c2: [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
        p: p2
      });
    }
    return out;
  };

  /** Ramer–Douglas–Peucker; keeps ink files small without visible loss. */
  G.simplify = function (points, tolerance) {
    if (points.length < 3) return points.slice();
    const tol = tolerance || 0.6;
    const keep = new Array(points.length).fill(false);
    keep[0] = keep[points.length - 1] = true;

    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [first, last] = stack.pop();
      let maxDist = 0, index = -1;
      for (let i = first + 1; i < last; i++) {
        const d = U.distToSegment(points[i][0], points[i][1],
          points[first][0], points[first][1], points[last][0], points[last][1]);
        if (d > maxDist) { maxDist = d; index = i; }
      }
      if (maxDist > tol && index > 0) {
        keep[index] = true;
        stack.push([first, index], [index, last]);
      }
    }
    const out = [];
    for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
    return out;
  };

  /* ------------------------------------------------------------------ */
  /*  Hit testing                                                        */
  /* ------------------------------------------------------------------ */

  function pointInPolygon(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  G.pointInPolygon = pointInPolygon;

  function nearPolyline(pts, x, y, tol, closed) {
    for (let i = 1; i < pts.length; i++) {
      if (U.distToSegment(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= tol) return true;
    }
    if (closed && pts.length > 2) {
      const a = pts[pts.length - 1], b = pts[0];
      if (U.distToSegment(x, y, a[0], a[1], b[0], b[1]) <= tol) return true;
    }
    return false;
  }

  /**
   * Does the element contain / lie near this world point?
   * @param {number} slack extra tolerance in world units (scaled by zoom by the caller)
   */
  G.hit = function (el, wx, wy, slack) {
    if (el.hidden) return false;
    slack = slack || 0;
    // A highlighter is painted 3.4x wider than its nominal width, so the
    // grabbable band has to match what is on screen.
    const visual = (el.strokeWidth || 2) * (el.type === 'draw' && el.brush === 'marker' ? 3.4 : 1);
    const tol = Math.max(visual, 6) / 2 + slack;
    const p = G.toLocal(el, wx, wy);

    if (M.isLinear(el)) {
      const pts = el.points || [];
      if (nearPolyline(pts, p.x, p.y, tol, false)) return true;
      return pts.length === 1 && U.dist(p.x, p.y, pts[0][0], pts[0][1]) <= tol;
    }

    if (el.type === 'text' || el.type === 'note' || el.type === 'image' || el.type === 'comment' || el.type === 'table') {
      return p.x >= -slack && p.y >= -slack && p.x <= el.w + slack && p.y <= el.h + slack;
    }

    if (el.type === 'frame') {
      // Frames grab clicks on their border and their title, not their interior.
      const onEdge = !(p.x > tol + 2 && p.y > tol + 2 && p.x < el.w - tol - 2 && p.y < el.h - tol - 2);
      const inside = p.x >= -slack && p.y >= -28 && p.x <= el.w + slack && p.y <= el.h + slack;
      return inside && (onEdge || p.y < 0);
    }

    const subs = G.outline(el);
    const filled = el.fill && el.fill !== 'transparent' && el.fillStyle !== 'none';
    for (const sub of subs) {
      if (filled && pointInPolygon(sub.pts, p.x, p.y)) return true;
      if (nearPolyline(sub.pts, p.x, p.y, tol, sub.closed)) return true;
    }
    // A labelled shape should also be grabbable by its text.
    if (M.textOf(el) && p.x >= 0 && p.y >= 0 && p.x <= el.w && p.y <= el.h) return true;
    return false;
  };

  /** Topmost element at a point (respects lock + hidden). */
  G.pick = function (elements, wx, wy, slack, opts) {
    opts = opts || {};
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (el.hidden) continue;
      if (el.locked && !opts.includeLocked) continue;
      if (opts.filter && !opts.filter(el)) continue;
      if (G.hit(el, wx, wy, slack || 0)) return el;
    }
    return null;
  };

  /** Everything whose bbox falls inside a marquee (world rect). */
  G.pickIn = function (elements, rect, opts) {
    opts = opts || {};
    const out = [];
    for (const el of elements) {
      if (el.hidden || (el.locked && !opts.includeLocked)) continue;
      if (el.type === 'frame' && !opts.includeFrames) continue;
      const b = G.aabb(el);
      if (opts.touch ? G.boxIntersects(rect, b) : G.boxContains(rect, b)) out.push(el);
    }
    return out;
  };

  /* ------------------------------------------------------------------ */
  /*  Transform                                                          */
  /* ------------------------------------------------------------------ */

  G.translate = function (el, dx, dy) {
    el.x += dx;
    el.y += dy;
    return el;
  };

  /** Scale an element about a fixed world origin (used for group resize). */
  G.scaleAbout = function (el, ox, oy, sx, sy) {
    el.x = ox + (el.x - ox) * sx;
    el.y = oy + (el.y - oy) * sy;
    el.w *= sx;
    el.h *= sy;
    if (el.points) el.points = el.points.map(([x, y]) => [x * sx, y * sy]);
    if (el.type === 'text') el.fontSize = Math.max(6, el.fontSize * ((sx + sy) / 2));
    return el;
  };

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  G.HANDLES = HANDLES;

  /** Screen positions of the 8 resize handles + the rotation grip. */
  G.handlePositions = function (el) {
    const c = G.center(el);
    const pt = (lx, ly) => U.rotate(el.x + lx, el.y + ly, c.x, c.y, el.angle || 0);
    return {
      nw: pt(0, 0), n: pt(el.w / 2, 0), ne: pt(el.w, 0),
      e: pt(el.w, el.h / 2), se: pt(el.w, el.h), s: pt(el.w / 2, el.h),
      sw: pt(0, el.h), w: pt(0, el.h / 2),
      rot: pt(el.w / 2, -Math.max(26, Math.abs(el.h) * 0.12))
    };
  };

  /**
   * Resize one element by dragging `handle` to a world point.
   * `orig` is a snapshot taken at gesture start.
   */
  G.resize = function (el, orig, handle, wx, wy, opts) {
    opts = opts || {};
    const c0 = { x: orig.x + orig.w / 2, y: orig.y + orig.h / 2 };
    const local = U.rotate(wx, wy, c0.x, c0.y, -(orig.angle || 0));

    let x0 = orig.x, y0 = orig.y, x1 = orig.x + orig.w, y1 = orig.y + orig.h;
    if (handle.indexOf('n') >= 0) y0 = local.y;
    if (handle.indexOf('s') >= 0) y1 = local.y;
    if (handle.indexOf('w') >= 0) x0 = local.x;
    if (handle.indexOf('e') >= 0) x1 = local.x;

    let nw = x1 - x0, nh = y1 - y0;

    if (opts.lockAspect && orig.w && orig.h) {
      const ratio = Math.abs(orig.w / orig.h);
      if (Math.abs(nw) / ratio > Math.abs(nh)) nh = (Math.abs(nw) / ratio) * Math.sign(nh || 1);
      else nw = Math.abs(nh) * ratio * Math.sign(nw || 1);
      if (handle.indexOf('n') >= 0) y0 = y1 - nh; else y1 = y0 + nh;
      if (handle.indexOf('w') >= 0) x0 = x1 - nw; else x1 = x0 + nw;
    }

    const minSize = opts.min || 4;
    if (Math.abs(nw) < minSize) { nw = minSize * (nw < 0 ? -1 : 1); x1 = x0 + nw; }
    if (Math.abs(nh) < minSize) { nh = minSize * (nh < 0 ? -1 : 1); y1 = y0 + nh; }

    // Keep the anchor corner where the user expects it under rotation.
    const newLocalCenter = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    const worldCenter = U.rotate(newLocalCenter.x, newLocalCenter.y, c0.x, c0.y, orig.angle || 0);

    const scaleX = orig.w ? nw / orig.w : 1;
    const scaleY = orig.h ? nh / orig.h : 1;

    el.w = Math.abs(nw);
    el.h = Math.abs(nh);
    el.x = worldCenter.x - el.w / 2;
    el.y = worldCenter.y - el.h / 2;

    if (orig.points) {
      el.points = orig.points.map(([px, py]) => [
        (scaleX < 0 ? orig.w - px : px) * Math.abs(scaleX),
        (scaleY < 0 ? orig.h - py : py) * Math.abs(scaleY)
      ]);
    }
    if (orig.type === 'text' && opts.scaleFont !== false) {
      el.fontSize = Math.max(6, (orig.fontSize || 20) * Math.abs(handle.length === 2 ? (Math.abs(scaleX) + Math.abs(scaleY)) / 2 : scaleY));
    }
    return el;
  };

  G.rotateTo = function (el, orig, wx, wy, snapDeg) {
    const c = { x: orig.x + orig.w / 2, y: orig.y + orig.h / 2 };
    let angle = Math.atan2(wy - c.y, wx - c.x) + Math.PI / 2;
    if (snapDeg) {
      const step = U.rad(snapDeg);
      angle = Math.round(angle / step) * step;
    }
    el.angle = angle;
    return el;
  };

  /**
   * Mirror an element in place about its own centre.
   * Mirroring reverses the sense of rotation, so the angle is negated for
   * either axis; the content itself is mirrored (points, or a flip flag for
   * outlines). Text is never mirrored — it would be unreadable.
   */
  G.flip = function (el, axis) {
    if (el.points) {
      el.points = el.points.map(([x, y]) => (axis === 'h' ? [el.w - x, y] : [x, el.h - y]));
    } else if (M.SHAPES.indexOf(el.type) >= 0) {
      if (axis === 'h') el.flipX = !el.flipX;
      else el.flipY = !el.flipY;
    }
    el.angle = el.angle ? -el.angle : 0;
    return el;
  };

  /* ------------------------------------------------------------------ */
  /*  Snapping & alignment guides                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Find the smallest nudge that lines the moving box up with its neighbours.
   * @returns {{dx:number, dy:number, guides:Array}}
   */
  G.snapMove = function (movingBox, others, threshold) {
    const t = threshold;
    const mv = movingBox;
    const targetsX = [
      { v: mv.x, kind: 'left' },
      { v: mv.x + mv.w / 2, kind: 'cx' },
      { v: mv.x + mv.w, kind: 'right' }
    ];
    const targetsY = [
      { v: mv.y, kind: 'top' },
      { v: mv.y + mv.h / 2, kind: 'cy' },
      { v: mv.y + mv.h, kind: 'bottom' }
    ];

    let bestX = null, bestY = null;
    for (const b of others) {
      const cand = [b.x, b.x + b.w / 2, b.x + b.w];
      for (const t1 of targetsX) {
        for (const c of cand) {
          const d = c - t1.v;
          if (Math.abs(d) <= t && (!bestX || Math.abs(d) < Math.abs(bestX.d))) {
            bestX = { d, at: c, box: b };
          }
        }
      }
      const candY = [b.y, b.y + b.h / 2, b.y + b.h];
      for (const t2 of targetsY) {
        for (const c of candY) {
          const d = c - t2.v;
          if (Math.abs(d) <= t && (!bestY || Math.abs(d) < Math.abs(bestY.d))) {
            bestY = { d, at: c, box: b };
          }
        }
      }
    }

    const guides = [];
    const dx = bestX ? bestX.d : 0;
    const dy = bestY ? bestY.d : 0;
    if (bestX) {
      const b = bestX.box;
      guides.push({
        axis: 'v', at: bestX.at,
        from: Math.min(b.y, mv.y + dy), to: Math.max(b.y + b.h, mv.y + mv.h + dy)
      });
    }
    if (bestY) {
      const b = bestY.box;
      guides.push({
        axis: 'h', at: bestY.at,
        from: Math.min(b.x, mv.x + dx), to: Math.max(b.x + b.w, mv.x + mv.w + dx)
      });
    }
    return { dx, dy, guides };
  };

  G.snapToGrid = function (v, grid) {
    return Math.round(v / grid) * grid;
  };

  /* ------------------------------------------------------------------ */
  /*  Binding: arrows that stick to shapes                               */
  /* ------------------------------------------------------------------ */

  /**
   * Where should a connector meet this element, coming from `fromX/fromY`?
   * Returns a point on the boundary plus a small gap.
   */
  /** Distance along a ray from (ox,oy) in direction (ux,uy) to the far-most crossing of a polygon. */
  function rayPolygon(pts, ox, oy, ux, uy) {
    let best = -1;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const ax = pts[j][0], ay = pts[j][1], bx = pts[i][0], by = pts[i][1];
      const ex = bx - ax, ey = by - ay;
      const den = ux * ey - uy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((ax - ox) * ey - (ay - oy) * ex) / den;   // along the ray
      const s = ((ax - ox) * uy - (ay - oy) * ux) / den;   // along the edge
      if (t >= 0 && s >= -1e-9 && s <= 1 + 1e-9 && t > best) best = t;
    }
    return best;
  }

  G.anchorOn = function (el, fromX, fromY, gap) {
    const c = G.center(el);
    const g = gap === undefined ? 6 : gap;
    // Work in the element's own (unrotated) frame, so rotated shapes are
    // met on their real edge rather than on their old axis-aligned box.
    const angle = el.angle || 0;
    const from = U.rotate(fromX, fromY, c.x, c.y, -angle);
    const dx = from.x - c.x, dy = from.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    let k;

    if (el.type === 'ellipse') {
      const rx = Math.abs(el.w) / 2, ry = Math.abs(el.h) / 2;
      k = 1 / Math.sqrt((ux * ux) / (rx * rx || 1) + (uy * uy) / (ry * ry || 1));
    } else if (M.SHAPES.indexOf(el.type) >= 0 && el.type !== 'rect') {
      // Diamonds, triangles, stars… — intersect with the true outline.
      const pts = G.outline(el)[0].pts.map((p) => [p[0] - el.w / 2, p[1] - el.h / 2]);
      k = rayPolygon(pts, 0, 0, ux, uy);
    }
    if (!(k > 0)) {
      const hw = Math.abs(el.w) / 2, hh = Math.abs(el.h) / 2;
      const tx = ux !== 0 ? hw / Math.abs(ux) : Infinity;
      const ty = uy !== 0 ? hh / Math.abs(uy) : Infinity;
      k = Math.min(tx, ty);
    }
    k += g;
    return U.rotate(c.x + ux * k, c.y + uy * k, c.x, c.y, angle);
  };

  /** Write world-space points back into a linear element (angle reset to 0). */
  G.setWorldPoints = function (link, world) {
    link.angle = 0;
    const minX = Math.min.apply(null, world.map((p) => p[0]));
    const minY = Math.min.apply(null, world.map((p) => p[1]));
    link.x = minX;
    link.y = minY;
    link.points = world.map((p) => [p[0] - minX, p[1] - minY]);
    link.w = Math.max(0.0001, Math.max.apply(null, link.points.map((p) => p[0])));
    link.h = Math.max(0.0001, Math.max.apply(null, link.points.map((p) => p[1])));
    return link;
  };

  /**
   * Where an elbow connector leaves a shape: the middle of the side that
   * faces the other end, pushed out by the gap. Returns the point and the
   * axis the first segment must travel along.
   */
  function elbowPort(el, toward, gap) {
    const b = G.aabb(el);
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const dx = toward.x - c.x, dy = toward.y - c.y;
    if (Math.abs(dx) / Math.max(1, b.w) >= Math.abs(dy) / Math.max(1, b.h)) {
      return { p: [dx >= 0 ? b.x + b.w + gap : b.x - gap, c.y], axis: 'h' };
    }
    return { p: [c.x, dy >= 0 ? b.y + b.h + gap : b.y - gap], axis: 'v' };
  }

  function dedupe(pts) {
    const out = [];
    pts.forEach((p) => {
      const q = out[out.length - 1];
      if (!q || Math.abs(q[0] - p[0]) > 0.01 || Math.abs(q[1] - p[1]) > 0.01) out.push(p);
    });
    // Drop middle points that sit on a straight run.
    for (let i = out.length - 2; i > 0; i--) {
      const a = out[i - 1], m = out[i], z = out[i + 1];
      const cross = (m[0] - a[0]) * (z[1] - a[1]) - (m[1] - a[1]) * (z[0] - a[0]);
      if (Math.abs(cross) < 0.01) out.splice(i, 1);
    }
    return out.length >= 2 ? out : pts.slice(0, 2);
  }

  /** Orthogonal path from a to b, leaving a along axisA and entering b along axisB. */
  G.elbowPath = function (a, b, axisA, axisB) {
    if (axisA === 'h' && axisB === 'h') {
      const mx = (a[0] + b[0]) / 2;
      return dedupe([a, [mx, a[1]], [mx, b[1]], b]);
    }
    if (axisA === 'v' && axisB === 'v') {
      const my = (a[1] + b[1]) / 2;
      return dedupe([a, [a[0], my], [b[0], my], b]);
    }
    if (axisA === 'h') return dedupe([a, [b[0], a[1]], b]);
    return dedupe([a, [a[0], b[1]], b]);
  };

  /** A gentle bow between two points, as three points for a smooth curve. */
  G.curvePath = function (a, b, bend) {
    const k = bend === undefined ? 0.18 : bend;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const mid = [(a[0] + b[0]) / 2 - (dy / len) * len * k, (a[1] + b[1]) / 2 + (dx / len) * len * k];
    return [a, mid, b];
  };

  /**
   * Rebuild a connector's path from its ends and its route
   * ('straight' | 'curve' | 'elbow'). Bound ends are re-anchored on their
   * shapes. Unbound straight connectors with hand-placed middle points are
   * left alone. Returns true when the element changed.
   */
  G.reroute = function (link, getById) {
    const pts = link.points;
    if (!pts || pts.length < 2) return false;
    const route = link.route || 'straight';
    const worldPts = G.linearPoints(link);
    let a = worldPts[0];
    let b = worldPts[worldPts.length - 1];

    const startEl = link.start && getById(link.start.id);
    const endEl = link.end && getById(link.end.id);
    if (!startEl && !endEl && route === 'straight') return false;

    let next;
    if (route === 'elbow') {
      let axisA = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 'h' : 'v';
      let axisB = axisA;
      const bAim = endEl ? G.center(endEl) : { x: b[0], y: b[1] };
      const aAim = startEl ? G.center(startEl) : { x: a[0], y: a[1] };
      if (startEl) { const port = elbowPort(startEl, bAim, link.start.gap || 6); a = port.p; axisA = port.axis; }
      if (endEl) { const port = elbowPort(endEl, aAim, link.end.gap || 6); b = port.p; axisB = port.axis; }
      if (!startEl && endEl) axisA = axisB;
      if (startEl && !endEl) axisB = axisA;
      next = G.elbowPath(a, b, axisA, axisB);
    } else {
      const aCenter = startEl ? G.center(startEl) : { x: a[0], y: a[1] };
      const bCenter = endEl ? G.center(endEl) : { x: b[0], y: b[1] };
      if (startEl) { const p = G.anchorOn(startEl, bCenter.x, bCenter.y, link.start.gap || 6); a = [p.x, p.y]; }
      if (endEl) { const p = G.anchorOn(endEl, aCenter.x, aCenter.y, link.end.gap || 6); b = [p.x, p.y]; }
      next = route === 'curve' ? G.curvePath(a, b, link.bend) : [a, b];
    }
    if (route === 'elbow') link.curve = false;
    else if (route === 'curve') link.curve = true;
    G.setWorldPoints(link, next);
    return true;
  };

  /** Recompute a bound connector's endpoints after its neighbours moved. */
  G.updateBinding = function (link, getById) {
    if (!link.start && !link.end) return false;
    const startEl = link.start && getById(link.start.id);
    const endEl = link.end && getById(link.end.id);
    if (!startEl && !endEl) return false;
    return G.reroute(link, getById);
  };

  /* ------------------------------------------------------------------ */
  /*  Shape recognition — turn a rough sketch into a clean shape         */
  /* ------------------------------------------------------------------ */

  /**
   * Classify a freehand stroke. Returns null when it isn't confident.
   * @returns {{type:string, box:{x,y,w,h}}|null}
   */
  G.recognize = function (worldPts) {
    // Judge by how much ink there is, not how many samples the device gave
    // us: a fast, clean square can arrive as five points.
    if (!worldPts || worldPts.length < 5) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let pathLen = 0;
    for (let i = 0; i < worldPts.length; i++) {
      const [x, y] = worldPts[i];
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (i) pathLen += U.dist(x, y, worldPts[i - 1][0], worldPts[i - 1][1]);
    }
    const w = maxX - minX, h = maxY - minY;
    if (w < 16 && h < 16) return null;
    if (pathLen < 60) return null;      // a flick or a tick mark, leave it alone
    const box = { x: minX, y: minY, w: Math.max(w, 8), h: Math.max(h, 8) };
    const diag = Math.hypot(w, h);
    const first = worldPts[0], last = worldPts[worldPts.length - 1];
    const gap = U.dist(first[0], first[1], last[0], last[1]);
    const closed = gap < diag * 0.28;

    // Straight line?
    if (!closed) {
      const straight = U.dist(first[0], first[1], last[0], last[1]) / pathLen;
      if (straight > 0.94 && pathLen > 24) return { type: 'line', box, from: first, to: last };
      return null;
    }

    const simplified = G.simplify(worldPts, Math.max(2.5, diag * 0.035));
    // Drop the duplicated closing vertex.
    const corners = simplified.length > 2 &&
      U.dist(simplified[0][0], simplified[0][1], simplified[simplified.length - 1][0], simplified[simplified.length - 1][1]) < diag * 0.2
      ? simplified.slice(0, -1) : simplified;

    const area = Math.abs(polygonArea(worldPts));
    const boxArea = w * h || 1;
    const fill = area / boxArea;

    if (corners.length < 3) return null;

    if (corners.length >= 8 && fill > 0.62 && fill < 0.88) {
      // A circle fills ~π/4 = 0.785 of its bounding box.
      return { type: 'ellipse', box };
    }
    if (corners.length === 4) {
      // Rectangle fills ~1.0, diamond ~0.5.
      if (fill > 0.72) return { type: 'rect', box };
      if (fill > 0.36 && fill < 0.68) return { type: 'diamond', box };
    }
    if (corners.length === 3 && fill > 0.35 && fill < 0.72) return { type: 'triangle', box };
    if (corners.length >= 5 && corners.length <= 7 && fill > 0.6) return { type: 'hexagon', box };
    if (fill > 0.85) return { type: 'rect', box };
    return null;
  };

  function polygonArea(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    }
    return a / 2;
  }
  G.polygonArea = polygonArea;

  IK.geom = G;
})(window.IK = window.IK || {});
