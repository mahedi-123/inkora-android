/* ------------------------------------------------------------------ *
 *  Starter templates — a board you can actually use in one click.      *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const M = IK.model;
  const store = IK.store;
  const G = IK.geom;

  const T = {};

  /* ---- tiny builders ------------------------------------------------ */

  const style = () => Object.assign(M.defaultStyle(), { sketch: 0 });

  function rect(x, y, w, h, opts) {
    return M.create('rect', Object.assign({
      x, y, w, h, roundness: 0.5, stroke: '#c3c9d4', fill: 'transparent', strokeWidth: 1.5
    }, opts || {}), style());
  }

  function label(x, y, text, opts) {
    const el = M.create('text', Object.assign({
      x, y, w: 260, h: 30, text, fontSize: 22, fontWeight: 600,
      textAlign: 'left', vAlign: 'top', stroke: '#1e1e21'
    }, opts || {}), style());
    return el;
  }

  function note(x, y, text, color, opts) {
    return M.create('note', Object.assign({
      x, y, w: 170, h: 130, text: text || '', fill: color || M.PALETTE.note[0],
      fontSize: 16, textAlign: 'left', vAlign: 'top', stroke: 'transparent'
    }, opts || {}), style());
  }

  function shape(type, x, y, w, h, text, opts) {
    return M.create(type, Object.assign({
      x, y, w, h, text: text || '', fill: '#ffffff', stroke: '#4c6ef5',
      strokeWidth: 2, textAlign: 'center', vAlign: 'middle', fontSize: 16, roundness: 0.6
    }, opts || {}), style());
  }

  function arrow(x1, y1, x2, y2, opts) {
    const el = M.create('arrow', Object.assign({
      x: x1, y: y1,
      points: [[0, 0], [x2 - x1, y2 - y1]],
      stroke: '#868e96', strokeWidth: 2, arrowEnd: 'arrow'
    }, opts || {}), style());
    G.normalizeLinear(el);
    return el;
  }

  function frame(x, y, w, h, name) {
    return M.create('frame', { x, y, w, h, name }, style());
  }

  function columns(titles, colors, opts) {
    opts = opts || {};
    const colW = opts.colW || 250;
    const gap = opts.gap || 24;
    const top = opts.top || 0;
    const height = opts.height || 620;
    const out = [];
    titles.forEach((t, i) => {
      const x = i * (colW + gap);
      out.push(rect(x, top, colW, height, { fill: 'transparent', stroke: '#dee2e6' }));
      out.push(label(x + 16, top + 14, t, { w: colW - 32, fontSize: 19 }));
      if (opts.seed) {
        out.push(note(x + 22, top + 60, '', (colors && colors[i]) || M.PALETTE.note[i % M.PALETTE.note.length],
          { w: colW - 44, h: 110 }));
      }
    });
    return out;
  }

  /* ---- the catalogue ------------------------------------------------ */

  T.list = [
    {
      id: 'blank', name: 'Blank board', group: 'Basics',
      description: 'An empty infinite canvas.',
      build: () => []
    },
    {
      id: 'kanban', name: 'Kanban board', group: 'Planning',
      description: 'Backlog → In progress → Review → Done.',
      build: () => [label(0, -56, 'Kanban', { fontSize: 30 })].concat(
        columns(['Backlog', 'In progress', 'Review', 'Done'],
          ['#e9ecef', '#c5e3ff', '#ffe9a8', '#c3fae8'], { seed: true })
      )
    },
    {
      id: 'retro', name: 'Sprint retro', group: 'Planning',
      description: 'What went well, what did not, what to try.',
      build: () => [label(0, -56, 'Retrospective', { fontSize: 30 })].concat(
        columns(['😀 Went well', '😕 Didn\'t go well', '💡 Ideas', '✅ Actions'],
          ['#c3fae8', '#ffc9c9', '#ffe9a8', '#c5e3ff'], { seed: true })
      )
    },
    {
      id: 'swot', name: 'SWOT analysis', group: 'Strategy',
      description: 'Strengths, weaknesses, opportunities, threats.',
      build: () => {
        const w = 300, h = 240, gap = 18;
        const cells = [
          ['Strengths', '#c3fae8'], ['Weaknesses', '#ffc9c9'],
          ['Opportunities', '#c5e3ff'], ['Threats', '#ffd8a8']
        ];
        const out = [label(0, -56, 'SWOT', { fontSize: 30 })];
        cells.forEach(([title, color], i) => {
          const x = (i % 2) * (w + gap);
          const y = Math.floor(i / 2) * (h + gap);
          out.push(M.create('rect', {
            x, y, w, h, fill: color, stroke: 'transparent', roundness: 0.5,
            text: '', fillStyle: 'solid'
          }, style()));
          out.push(label(x + 16, y + 12, title, { fontSize: 18, w: w - 32 }));
        });
        return out;
      }
    },
    {
      id: 'lean', name: 'Lean canvas', group: 'Strategy',
      description: 'One-page business model for a new product.',
      build: () => {
        const cells = [
          ['Problem', 0, 0, 1, 2], ['Solution', 1, 0, 1, 1], ['Unique value', 2, 0, 1, 2],
          ['Unfair advantage', 3, 0, 1, 1], ['Customer segments', 4, 0, 1, 2],
          ['Key metrics', 1, 1, 1, 1], ['Channels', 3, 1, 1, 1],
          ['Cost structure', 0, 2, 2.5, 1], ['Revenue streams', 2.5, 2, 2.5, 1]
        ];
        const cw = 220, ch = 170, gap = 10;
        const out = [label(0, -56, 'Lean canvas', { fontSize: 30 })];
        cells.forEach(([title, cx, cy, sw, sh]) => {
          const x = cx * (cw + gap), y = cy * (ch + gap);
          out.push(rect(x, y, sw * cw + (sw - 1) * gap, sh * ch + (sh - 1) * gap, { stroke: '#ced4da' }));
          out.push(label(x + 14, y + 10, title, { fontSize: 16, w: cw - 28 }));
        });
        return out;
      }
    },
    {
      id: 'flow', name: 'Flowchart starter', group: 'Diagrams',
      description: 'Start, decision, two branches, end — already wired up.',
      build: () => {
        const start = shape('ellipse', 120, 0, 170, 70, 'Start', { stroke: '#2f9e44' });
        const step = shape('rect', 120, 130, 170, 80, 'Do the thing');
        const dec = shape('diamond', 100, 260, 210, 130, 'Works?', { stroke: '#f08c00' });
        const yes = shape('rect', -110, 440, 170, 80, 'Ship it', { stroke: '#2f9e44' });
        const no = shape('rect', 330, 440, 170, 80, 'Fix it', { stroke: '#e03131' });
        const end = shape('ellipse', 120, 590, 170, 70, 'Done', { stroke: '#2f9e44' });
        const a1 = arrow(205, 70, 205, 130);
        a1.start = { id: start.id, gap: 6 }; a1.end = { id: step.id, gap: 6 };
        const a2 = arrow(205, 210, 205, 260);
        a2.start = { id: step.id, gap: 6 }; a2.end = { id: dec.id, gap: 6 };
        const a3 = arrow(150, 360, -25, 440, { text: 'yes' });
        a3.start = { id: dec.id, gap: 6 }; a3.end = { id: yes.id, gap: 6 };
        const a4 = arrow(260, 360, 415, 440, { text: 'no' });
        a4.start = { id: dec.id, gap: 6 }; a4.end = { id: no.id, gap: 6 };
        const a5 = arrow(-25, 520, 205, 590);
        a5.start = { id: yes.id, gap: 6 }; a5.end = { id: end.id, gap: 6 };
        const a6 = arrow(415, 520, 290, 260, { arrowEnd: 'arrow' });
        a6.start = { id: no.id, gap: 6 }; a6.end = { id: dec.id, gap: 6 };
        return [start, step, dec, yes, no, end, a1, a2, a3, a4, a5, a6];
      }
    },
    {
      id: 'mindmap', name: 'Mind map', group: 'Diagrams',
      description: 'A central idea with branches — press Tab to grow it.',
      build: () => {
        const root = shape('ellipse', 260, 220, 220, 100, 'Central idea',
          { stroke: '#7048e8', fill: '#f3f0ff', fontSize: 18, fontWeight: 600 });
        const kids = [
          shape('rect', 0, 60, 180, 70, 'Branch one', { stroke: '#7048e8' }),
          shape('rect', 0, 380, 180, 70, 'Branch two', { stroke: '#7048e8' }),
          shape('rect', 560, 60, 180, 70, 'Branch three', { stroke: '#7048e8' }),
          shape('rect', 560, 380, 180, 70, 'Branch four', { stroke: '#7048e8' })
        ];
        const links = kids.map((k) => {
          const a = arrow(370, 270, k.x + k.w / 2, k.y + k.h / 2, { arrowEnd: 'none', stroke: '#b197fc', curve: true });
          a.start = { id: root.id, gap: 4 };
          a.end = { id: k.id, gap: 4 };
          return a;
        });
        return [root].concat(kids).concat(links);
      }
    },
    {
      id: 'week', name: 'Weekly planner', group: 'Planning',
      description: 'Five days, room for notes under each.',
      build: () => [label(0, -56, 'This week', { fontSize: 30 })].concat(
        columns(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], null,
          { colW: 210, height: 560 })
      )
    },
    {
      id: 'brainstorm', name: 'Brainstorm grid', group: 'Basics',
      description: 'A wall of empty sticky notes, ready to fill.',
      build: () => {
        const out = [label(0, -56, 'Brainstorm', { fontSize: 30 })];
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 5; c++) {
            out.push(note(c * 190, r * 150, '', M.PALETTE.note[(r + c) % M.PALETTE.note.length]));
          }
        }
        return out;
      }
    },
    {
      id: 'story', name: 'User story map', group: 'Planning',
      description: 'Activities across the top, releases down the side.',
      build: () => {
        const out = [label(0, -56, 'Story map', { fontSize: 30 })];
        const acts = ['Discover', 'Sign up', 'Create', 'Share', 'Return'];
        acts.forEach((a, i) => {
          out.push(note(i * 190, 0, a, '#c5e3ff', { h: 80, fontSize: 17 }));
          for (let r = 0; r < 3; r++) out.push(note(i * 190, 110 + r * 140, '', '#ffe9a8', { h: 120 }));
        });
        ['Release 1', 'Release 2', 'Release 3'].forEach((r, i) => {
          out.push(label(-150, 150 + i * 140, r, { fontSize: 16, w: 130 }));
        });
        return out;
      }
    },
    {
      id: 'empathy', name: 'Empathy map', group: 'Strategy',
      description: 'Says, thinks, does, feels — around one person.',
      build: () => {
        const quads = [['Says', '#c5e3ff'], ['Thinks', '#e5dbff'], ['Does', '#c3fae8'], ['Feels', '#ffd8a8']];
        const out = [label(0, -56, 'Empathy map', { fontSize: 30 })];
        quads.forEach(([t, color], i) => {
          const x = (i % 2) * 320, y = Math.floor(i / 2) * 260;
          out.push(M.create('rect', { x, y, w: 300, h: 240, fill: color, stroke: 'transparent', roundness: 0.4 }, style()));
          out.push(label(x + 16, y + 12, t, { fontSize: 18 }));
        });
        out.push(shape('ellipse', 245, 215, 150, 150, 'Our user', { fill: '#ffffff', fontWeight: 600 }));
        return out;
      }
    },
    {
      id: 'deck', name: 'Presentation frames', group: 'Basics',
      description: 'Four 16:9 frames — present them with P.',
      build: () => {
        const out = [];
        for (let i = 0; i < 4; i++) {
          const x = (i % 2) * 1040, y = Math.floor(i / 2) * 640;
          out.push(frame(x, y, 960, 540, 'Slide ' + (i + 1)));
          out.push(label(x + 60, y + 60, i === 0 ? 'Title slide' : 'Slide ' + (i + 1), { fontSize: 40, w: 700 }));
        }
        return out;
      }
    }
  ];

  T.groups = function () {
    const map = new Map();
    T.list.forEach((t) => {
      if (!map.has(t.group)) map.set(t.group, []);
      map.get(t.group).push(t);
    });
    return map;
  };

  T.get = (id) => T.list.filter((t) => t.id === id)[0] || null;

  /** Insert a template into the current page, centred in the viewport. */
  T.insert = function (id, opts) {
    const tpl = T.get(id);
    if (!tpl) return null;
    const els = tpl.build();
    if (!els.length) return [];

    const box = G.aabbOf(els);
    const view = store.viewport();
    const dx = (view.x + view.w / 2) - (box.x + box.w / 2);
    const dy = (view.y + view.h / 2) - (box.y + box.h / 2);
    els.forEach((el) => { el.x += dx; el.y += dy; });

    store.addMany(els, { select: false });
    if (!opts || opts.fit !== false) store.zoomToFit({ animate: true, maxScale: 1.1 });
    return els;
  };

  /** Replace the whole board with a template (used from the welcome screen). */
  T.startNew = function (id) {
    const doc = IK.model.createDocument();
    doc.title = (T.get(id) || {}).name || 'Untitled';
    store.setDocument(doc, {});
    if (id !== 'blank') T.insert(id, { fit: true });
    store.markClean();
    return doc;
  };

  IK.templates = T;
})(window.IK = window.IK || {});
