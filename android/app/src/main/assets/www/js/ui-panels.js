/* ------------------------------------------------------------------ *
 *  Chrome — toolbar, inspector, pages, zoom bar, minimap, status.      *
 *  Everything is built in JS from the command registry so the markup    *
 *  never drifts out of sync with the features.                          *
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
  const el = U.el;
  const st = store.state;

  const UI = { lastPointer: null };
  let root = null;
  let inspectorHost = null;
  let toolbarHost = null;

  /* ------------------------------------------------------------------ */
  /*  Small control builders                                             */
  /* ------------------------------------------------------------------ */

  function iconButton(opts) {
    const b = el('button', {
      class: 'btn' + (opts.class ? ' ' + opts.class : ''),
      type: 'button',
      title: opts.title + (opts.accel ? '  ' + U.prettyKeys(opts.accel) : ''),
      'aria-label': opts.title,
      html: IK.icon(opts.icon, opts.size || 20),
      onclick: opts.onclick
    });
    if (opts.active) b.classList.add('is-active');
    return b;
  }

  function section(title, children, opts) {
    return el('div', { class: 'insp__section' + (opts && opts.tight ? ' insp__section--tight' : '') }, [
      title ? el('div', { class: 'insp__label', text: title }) : null
    ].concat(children));
  }

  /* ---- colour ------------------------------------------------------ */

  /** Recently used colours, kept per role so each palette has its own. */
  function recentColors(role) {
    const list = P.get('recent.' + role, null);
    return Array.isArray(list) ? list.filter((c) => U.normalizeHex(c)) : [];
  }

  function rememberColor(role, color) {
    const hex = U.normalizeHex(color);
    if (!hex) return;
    const list = recentColors(role).filter((c) => c !== hex);
    list.unshift(hex);
    P.set('recent.' + role, list.slice(0, 10));
  }

  function swatchButton(color, isActive, onPick, label) {
    const transparent = color === 'transparent';
    // Swatches show what will actually be painted in this theme, so the
    // preview never lies about the result.
    const shown = transparent ? '' : R.previewColor(color);
    const b = el('button', {
      type: 'button',
      class: 'swatch' + (isActive ? ' is-active' : '') + (transparent ? ' swatch--none' : ''),
      title: label || (transparent ? 'No fill' : color),
      'aria-label': label || (transparent ? 'No fill' : color),
      'aria-pressed': isActive ? 'true' : 'false',
      style: { background: shown },
      onclick: () => onPick(color)
    });
    if (!transparent && U.luminance(shown) > 0.86) b.classList.add('swatch--pale');
    return b;
  }

  /**
   * A full colour control: preset grid, plus a chip that opens a picker with
   * an eyedropper-grade native input, hex entry and recent colours.
   *
   * @param {object} opts {role, value, onPick, allowNone, auto:{label,value}}
   */
  function colorField(opts) {
    const role = opts.role;
    const presets = (M.PALETTE[role] || []).slice();
    const value = opts.value;
    const isPreset = presets.some((c) => U.sameColor(c, value)) ||
      (value === 'transparent' && presets.indexOf('transparent') >= 0) ||
      (opts.auto && value === opts.auto.value);

    const pick = (c) => {
      if (c !== 'transparent' && c !== null) rememberColor(role, c);
      opts.onPick(c);
    };

    const grid = el('div', { class: 'swatches' });
    if (opts.auto) {
      grid.appendChild(el('button', {
        type: 'button',
        class: 'swatch swatch--auto' + (value === opts.auto.value ? ' is-active' : ''),
        title: opts.auto.label,
        'aria-label': opts.auto.label,
        onclick: () => opts.onPick(opts.auto.value)
      }, [el('span', { text: 'A' })]));
    }
    presets.forEach((c) => {
      grid.appendChild(swatchButton(c, U.sameColor(c, value) || (c === 'transparent' && value === 'transparent'), pick));
    });

    // The chip doubles as "current colour" readout and "custom…" trigger.
    const chip = el('button', {
      type: 'button',
      class: 'cfield__chip' + (isPreset ? '' : ' is-active'),
      title: 'Custom colour — click for a picker and hex entry',
      onclick: (e) => { e.stopPropagation(); openPicker(chip, role, value, pick, opts); }
    }, [
      el('span', {
        class: 'cfield__chipDot' + (value === 'transparent' || !value ? ' is-none' : ''),
        style: { background: value && value !== 'transparent' ? R.previewColor(value) : '' }
      }),
      el('span', { class: 'cfield__chipText', text: value === 'transparent' ? 'None' : (U.normalizeHex(value) || 'Auto') })
    ]);

    return el('div', { class: 'cfield' }, [grid, chip]);
  }

  function openPicker(anchor, role, value, pick, opts) {
    const start = U.normalizeHex(value) || '#4c6ef5';

    const native = el('input', {
      type: 'color', class: 'cpick__native', value: start,
      oninput: (e) => { hex.value = e.target.value; apply(e.target.value); }
    });

    const hex = el('input', {
      type: 'text', class: 'cpick__hex', value: start,
      spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Hex colour',
      oninput: (e) => {
        const norm = U.normalizeHex(e.target.value);
        e.target.classList.toggle('is-bad', !norm && e.target.value.trim() !== '');
        if (norm) { native.value = norm; apply(norm); }
      },
      onkeydown: (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') IK.dialogs.closeFloating();
      }
    });

    let raf = 0;
    function apply(c) {
      // Throttle to one repaint per frame while the picker is dragged.
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; pick(c); });
    }

    const recent = recentColors(role);
    const body = el('div', { class: 'cpick' }, [
      el('div', { class: 'cpick__row' }, [
        el('label', { class: 'cpick__swatchWrap', title: 'Open the system colour picker' }, [native]),
        hex
      ]),
      recent.length
        ? el('div', { class: 'cpick__block' }, [
          el('div', { class: 'insp__label', text: 'Recent' }),
          el('div', { class: 'swatches' }, recent.map((c) =>
            swatchButton(c, U.sameColor(c, value), (col) => { hex.value = col; native.value = col; pick(col); })))
        ])
        : null,
      (opts.allowNone || opts.auto)
        ? el('div', { class: 'cpick__actions' }, [
          opts.allowNone ? el('button', {
            class: 'btn-ghost btn-ghost--sm', type: 'button', text: 'No fill',
            onclick: () => { opts.onPick('transparent'); IK.dialogs.closeFloating(); }
          }) : null,
          opts.auto ? el('button', {
            class: 'btn-ghost btn-ghost--sm', type: 'button', text: opts.auto.label,
            onclick: () => { opts.onPick(opts.auto.value); IK.dialogs.closeFloating(); }
          }) : null
        ])
        : null
    ]);

    IK.dialogs.floating(anchor, body, { width: 236 });
    setTimeout(() => hex.select(), 30);
  }

  /** Kept for callers that just want a preset row. */
  function swatches(colors, current, onPick) {
    const row = el('div', { class: 'swatches' });
    colors.forEach((c) => row.appendChild(swatchButton(c, U.sameColor(c, current), onPick)));
    return row;
  }

  function segmented(items, current, onPick) {
    const row = el('div', { class: 'segmented' });
    items.forEach((it) => {
      const item = el('button', {
        type: 'button',
        class: 'segmented__item' + (it.value === current ? ' is-active' : ''),
        title: it.title || it.label,
        html: it.icon ? IK.icon(it.icon, 16) : null,
        text: it.icon ? null : it.label,
        onclick: () => onPick(it.value)
      });
      if (it.font) { item.style.fontFamily = it.font; item.style.fontSize = '15px'; }
      row.appendChild(item);
    });
    return row;
  }

  function slider(opts) {
    const out = el('div', { class: 'slider' });
    const input = el('input', {
      type: 'range', min: opts.min, max: opts.max, step: opts.step || 1, value: opts.value,
      oninput: (e) => { value.textContent = fmt(e.target.value); opts.oninput(Number(e.target.value)); },
      onchange: (e) => opts.onchange && opts.onchange(Number(e.target.value))
    });
    const fmt = opts.format || ((v) => v);
    const value = el('span', { class: 'slider__value', text: fmt(opts.value) });
    out.appendChild(input);
    out.appendChild(value);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /*  Toolbar                                                            */
  /* ------------------------------------------------------------------ */

  const PRIMARY_TOOLS = ['select', 'hand', 'pen', 'marker', 'eraser', 'arrow', 'line', 'rect', 'ellipse', 'diamond', 'text', 'note', 'frame'];
  const MORE_SHAPES = ['triangle', 'star', 'hexagon', 'cylinder', 'cloud', 'bubble', 'parallelogram'];

  function buildToolbar() {
    toolbarHost.innerHTML = '';
    const bar = el('div', { class: 'panel toolbar', role: 'toolbar', 'aria-label': 'Tools' });

    PRIMARY_TOOLS.forEach((id) => {
      const spec = C.TOOLS.filter((t) => t[0] === id)[0];
      if (!spec) return;
      bar.appendChild(iconButton({
        icon: spec[2], title: spec[1], accel: spec[3],
        class: 'tool', active: st.tool === id,
        onclick: () => store.setTool(id)
      })).dataset.tool = id;
    });

    // "More shapes" popover
    const moreBtn = iconButton({
      icon: 'more', title: 'More shapes', class: 'tool',
      active: MORE_SHAPES.indexOf(st.tool) >= 0,
      onclick: (e) => {
        e.stopPropagation();
        IK.dialogs.popover(moreBtn, MORE_SHAPES.map((id) => {
          const spec = C.TOOLS.filter((t) => t[0] === id)[0];
          return { icon: spec[2], label: spec[1], run: () => store.setTool(id) };
        }));
      }
    });
    moreBtn.dataset.tool = 'more';
    bar.appendChild(moreBtn);

    bar.appendChild(el('div', { class: 'sep' }));
    bar.appendChild(iconButton({
      icon: 'laser', title: 'Laser pointer', accel: 'K', class: 'tool',
      active: st.tool === 'laser', onclick: () => store.setTool('laser')
    }));
    bar.appendChild(iconButton({
      icon: 'lock', title: 'Keep the tool selected after drawing', accel: 'Q',
      class: 'tool tool--toggle', active: st.ui.lockTool,
      onclick: () => C.run('tool.lockToggle')
    }));

    toolbarHost.appendChild(bar);
  }

  /* ------------------------------------------------------------------ */
  /*  Inspector (contextual style panel)                                 */
  /* ------------------------------------------------------------------ */

  const DRAW_TOOLS = ['pen', 'marker', 'line', 'arrow', 'text', 'note', 'comment'].concat(M.SHAPES);

  function inspectorTarget() {
    const sel = store.selected().filter((e) => !e.locked);
    if (sel.length) return { elements: sel, from: 'selection' };
    // The eraser has settings of its own, so it gets a panel even though it
    // has no colour or stroke to style.
    if (st.tool === 'eraser') return { elements: [], from: 'eraser' };
    if (DRAW_TOOLS.indexOf(st.tool) >= 0) return { elements: [], from: 'tool' };
    return null;
  }

  /** The eraser's own panel: what it removes, and how big it is. */
  function eraserPanel() {
    const panel = el('div', { class: 'panel insp', role: 'region', 'aria-label': 'Eraser' });

    panel.appendChild(section('Eraser', [
      segmented([
        { value: 'object', label: 'Whole', title: 'Remove the whole stroke you touch' },
        { value: 'part', label: 'Part', title: 'Rub out only the part you drag over' }
      ], st.ui.eraserMode, (mode) => {
        st.ui.eraserMode = mode;
        P.set('eraserMode', mode);
        store.emit('ui');
        refreshInspector();
      }),
      el('p', {
        class: 'insp__hint',
        text: st.ui.eraserMode === 'part'
          ? 'Rubs a hole in pen strokes and splits them. Shapes, notes and text still go whole — there is no part of them to rub out.'
          : 'Touch any stroke and all of it goes.'
      })
    ]));

    panel.appendChild(section('Size', [
      slider({
        min: 4, max: 120, step: 1, value: st.ui.eraserSize,
        format: (v) => v + 'px',
        oninput: (v) => {
          st.ui.eraserSize = v;
          R.overlay.eraserSize = v;
          R.request();
        },
        onchange: (v) => P.set('eraserSize', v)
      }),
      el('p', { class: 'insp__hint', text: 'Or press [ and ] while erasing.' })
    ]));

    return panel;
  }

  function commonValue(elements, key, fallback) {
    if (!elements.length) return fallback;
    const first = elements[0][key];
    return elements.every((e) => e[key] === first) ? first : undefined;
  }

  /**
   * Slider drags preview live and commit on release. The live preview
   * writes to the elements directly, so the drag is wrapped in an undo
   * batch opened on the first tick — otherwise the "before" snapshot would
   * already contain the new value and the change could not be undone.
   */
  let liveBatch = false;

  function applyStyle(patch) {
    const target = inspectorTarget();
    if (target && target.elements.length) {
      store.updateMany(target.elements.map((e) => e.id), patch);
      if (liveBatch) { liveBatch = false; store.endBatch('style', true); }
      // Remember the choice for the next thing drawn, too.
      Object.assign(st.style, patch);
      P.set('style', st.style);
      store.emit('style', st.style);
    } else {
      store.setStyle(patch, { applyToSelection: false });
    }
    refreshInspector();
    R.request();
  }

  function refreshInspector() {
    if (!inspectorHost) return;
    const target = inspectorTarget();
    if (!target || st.ui.presenting || st.ui.panelsHidden) {
      inspectorHost.classList.add('is-hidden');
      inspectorHost.innerHTML = '';
      return;
    }
    inspectorHost.classList.remove('is-hidden');
    inspectorHost.innerHTML = '';   // replace, never stack

    if (target.from === 'eraser') {
      inspectorHost.appendChild(eraserPanel());
      return;
    }

    const els = target.elements;
    const sample = els.length ? els[0] : st.style;
    const kinds = new Set(els.map((e) => e.type));
    const tool = st.tool;

    const isShape = els.length
      ? els.some((e) => M.SHAPES.indexOf(e.type) >= 0)
      : M.SHAPES.indexOf(tool) >= 0;
    const isLine = els.length
      ? els.some((e) => M.isLinear(e))
      : ['line', 'arrow', 'pen', 'marker'].indexOf(tool) >= 0;
    const isArrow = els.length ? els.some((e) => e.type === 'arrow' || e.type === 'line') : (tool === 'arrow' || tool === 'line');
    const isNote = els.length ? kinds.has('note') : tool === 'note';
    const hasText = els.length
      ? els.some((e) => M.canHaveText(e))
      : ['text', 'note'].indexOf(tool) >= 0 || isShape;
    const isImage = kinds.has('image');
    const strokeable = !isNote || els.length === 0;

    const panel = el('div', { class: 'panel insp', role: 'region', 'aria-label': 'Style' });

    /* --- colours --- */
    if (isNote) {
      panel.appendChild(section('Note colour', [
        colorField({
          role: 'note',
          value: commonValue(els, 'fill', st.style.noteColor),
          onPick: (c) => {
            // With nothing selected this sets the colour of the next note;
            // it must not become the fill of the next rectangle too.
            if (els.length) { st.style.noteColor = c; applyStyle({ fill: c }); }
            else applyStyle({ noteColor: c });
          }
        })
      ]));
    }

    // A mixed selection (a note plus shapes) still needs the stroke controls.
    if (els.length === 0 || els.some((e) => e.type !== 'note')) {
      panel.appendChild(section(isImage ? 'Tint' : 'Stroke', [
        colorField({
          role: 'stroke',
          value: commonValue(els, 'stroke', st.style.stroke),
          onPick: (c) => applyStyle({ stroke: c })
        })
      ]));
    }

    if (isShape) {
      panel.appendChild(section('Fill', [
        colorField({
          role: 'fill',
          value: commonValue(els, 'fill', st.style.fill),
          allowNone: true,
          onPick: (c) => applyStyle({ fill: c })
        }),
        segmented([
          { value: 'solid', label: 'Solid' },
          { value: 'hachure', label: 'Hatch' },
          { value: 'cross', label: 'Cross' }
        ], commonValue(els, 'fillStyle', st.style.fillStyle), (v) => applyStyle({ fillStyle: v }))
      ]));
    }

    /* --- stroke shape --- */
    if (strokeable) {
      panel.appendChild(section('Weight', [
        slider({
          min: 1, max: 32, value: commonValue(els, 'strokeWidth', st.style.strokeWidth) || 2,
          oninput: (v) => applyStyleLive({ strokeWidth: v }),
          onchange: (v) => applyStyle({ strokeWidth: v })
        }),
        segmented([
          { value: 'solid', icon: 'solid', title: 'Solid' },
          { value: 'dashed', icon: 'dash', title: 'Dashed' },
          { value: 'dotted', icon: 'dotted', title: 'Dotted' }
        ], commonValue(els, 'strokeStyle', st.style.strokeStyle), (v) => applyStyle({ strokeStyle: v }))
      ], { tight: true }));
    }

    /* --- hand-drawn --- */
    if (isShape || isLine) {
      panel.appendChild(section('Style', [
        segmented([
          { value: 0, label: 'Clean' },
          { value: 1, label: 'Sketchy' },
          { value: 2, label: 'Wild' }
        ], commonValue(els, 'sketch', st.style.sketch), (v) => applyStyle({ sketch: v }))
      ], { tight: true }));
    }

    /* --- corners --- */
    if (els.some((e) => e.type === 'rect') || (!els.length && tool === 'rect')) {
      panel.appendChild(section('Corners', [
        segmented([
          { value: 0, label: 'Sharp' },
          { value: 0.35, label: 'Round' },
          { value: 1, label: 'Pill' }
        ], commonValue(els, 'roundness', st.style.roundness), (v) => applyStyle({ roundness: v }))
      ], { tight: true }));
    }

    /* --- arrow ends --- */
    if (isArrow) {
      panel.appendChild(section('Ends', [
        el('div', { class: 'row' }, [
          segmented([
            { value: 'none', icon: 'endNone', title: 'No start head' },
            { value: 'arrow', icon: 'startArrow', title: 'Arrow' },
            { value: 'triangle', icon: 'startTriangle', title: 'Solid arrow' },
            { value: 'dot', icon: 'startDot', title: 'Dot' }
          ], commonValue(els, 'arrowStart', st.style.arrowStart), (v) => applyStyle({ arrowStart: v })),
          segmented([
            { value: 'none', icon: 'endNone', title: 'No end head' },
            { value: 'arrow', icon: 'endArrow', title: 'Arrow' },
            { value: 'triangle', icon: 'endTriangle', title: 'Solid arrow' },
            { value: 'dot', icon: 'endDot', title: 'Dot' }
          ], commonValue(els, 'arrowEnd', st.style.arrowEnd), (v) => applyStyle({ arrowEnd: v }))
        ]),
        segmented([
          { value: 'straight', label: 'Straight' },
          { value: 'curve', label: 'Curved' },
          { value: 'elbow', label: 'Elbow' }
        ], els.length ? (commonValue(els, 'route', undefined) || (commonValue(els, 'curve', false) && els.every((e) => (e.points || []).length > 2) ? 'curve' : 'straight'))
          : (st.style.route || 'straight'), (v) => setRoute(v, els))
      ], { tight: true }));
    }

    /* --- text --- */
    if (hasText) {
      panel.appendChild(section('Text colour', [
        colorField({
          role: 'text',
          value: commonValue(els, 'textColor', st.style.textColor || null),
          auto: { label: 'Auto', value: null },
          onPick: (c) => applyStyle({ textColor: c })
        })
      ]));
      panel.appendChild(section('Text', [
        segmented([
          { value: 'sans', label: 'Aa', title: 'Sans', font: M.FONTS.sans },
          { value: 'hand', label: 'Aa', title: 'Handwritten', font: M.FONTS.hand },
          { value: 'serif', label: 'Aa', title: 'Serif', font: M.FONTS.serif },
          { value: 'mono', label: 'Aa', title: 'Mono', font: M.FONTS.mono }
        ], commonValue(els, 'fontFamily', st.style.fontFamily), (v) => applyStyle({ fontFamily: v })),
        slider({
          min: 8, max: 96, value: commonValue(els, 'fontSize', st.style.fontSize) || 20,
          oninput: (v) => applyStyleLive({ fontSize: v }),
          onchange: (v) => applyStyle({ fontSize: v })
        }),
        el('div', { class: 'row' }, [
          segmented([
            { value: 'left', icon: 'alignLeft', title: 'Align left' },
            { value: 'center', icon: 'alignCenter', title: 'Align centre' },
            { value: 'right', icon: 'alignRight', title: 'Align right' }
          ], commonValue(els, 'textAlign', st.style.textAlign), (v) => applyStyle({ textAlign: v })),
          segmented([
            { value: 400, label: 'R' },
            { value: 700, label: 'B' }
          ], commonValue(els, 'fontWeight', st.style.fontWeight), (v) => applyStyle({ fontWeight: v }))
        ])
      ], { tight: true }));
    }

    /* --- opacity --- */
    panel.appendChild(section('Opacity', [
      slider({
        min: 5, max: 100, value: Math.round((commonValue(els, 'opacity', st.style.opacity) || 1) * 100),
        format: (v) => v + '%',
        oninput: (v) => applyStyleLive({ opacity: v / 100 }),
        onchange: (v) => applyStyle({ opacity: v / 100 })
      })
    ], { tight: true }));

    /* --- actions on the selection --- */
    if (els.length) {
      const actions = el('div', { class: 'insp__actions' });
      [
        ['order.front', 'front'], ['order.back', 'back'],
        ['edit.duplicate', 'duplicate'], ['edit.lock', 'lock'],
        ['edit.group', 'group'], ['edit.ungroup', 'ungroup'],
        ['edit.flipH', 'flip'], ['arrange.tidy', 'grid'], ['edit.delete', 'trash']
      ].forEach(([id, icon]) => {
        const cmd = C.get(id);
        if (!cmd) return;
        const enabled = !cmd.when || cmd.when();
        const b = iconButton({ icon, title: cmd.title, accel: cmd.accel, onclick: () => { C.run(id); refreshInspector(); } });
        if (!enabled) b.disabled = true;
        actions.appendChild(b);
      });
      panel.appendChild(section(els.length + ' selected', [
        actions,
        el('button', {
          class: 'insp__link', type: 'button', text: 'Align & distribute…',
          onclick: (e) => IK.dialogs.popover(e.currentTarget, [
            { icon: 'align', label: 'Align left', run: () => C.run('align.left') },
            { icon: 'align', label: 'Align centre', run: () => C.run('align.hcenter') },
            { icon: 'align', label: 'Align right', run: () => C.run('align.right') },
            { icon: 'align', label: 'Align top', run: () => C.run('align.top') },
            { icon: 'align', label: 'Align middle', run: () => C.run('align.vcenter') },
            { icon: 'align', label: 'Align bottom', run: () => C.run('align.bottom') },
            { separator: true },
            { icon: 'align', label: 'Distribute horizontally', run: () => C.run('align.distributeH') },
            { icon: 'align', label: 'Distribute vertically', run: () => C.run('align.distributeV') }
          ])
        })
      ]));
    }

    inspectorHost.appendChild(panel);
  }

  /** Straight / curved / elbow: re-shape the connectors, as one undo step. */
  function setRoute(route, els) {
    st.style.route = route;
    P.set('style', st.style);
    const targets = els.filter((e) => !e.locked && M.isLinear(e) && e.type !== 'draw');
    if (targets.length) {
      store.mutate(() => {
        targets.forEach((e) => {
          e.route = route;
          e.curve = route === 'curve';
          if (route === 'straight') {
            // Back to a single straight run between the two ends.
            const wp = G.linearPoints(e);
            G.setWorldPoints(e, [wp[0], wp[wp.length - 1]]);
          }
          G.reroute(e, (id) => store.byId(id));
        });
      }, 'route');
    }
    refreshInspector();
    R.request();
  }

  /** Live preview while dragging a slider — no undo entry until release. */
  function applyStyleLive(patch) {
    const target = inspectorTarget();
    if (target && target.elements.length) {
      if (!liveBatch) { liveBatch = true; store.beginBatch(); }
      target.elements.forEach((e) => Object.assign(e, patch));
      R.request();
    } else {
      Object.assign(st.style, patch);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Document chip & main menu                                          */
  /* ------------------------------------------------------------------ */

  function buildTopLeft() {
    const host = el('div', { class: 'hud hud--top-left' });

    const menuBtn = iconButton({
      icon: 'board', title: IK.BRAND.name + ' menu', class: 'btn--brand',
      onclick: (e) => {
        e.stopPropagation();
        IK.dialogs.popover(menuBtn, [
          { icon: 'file', label: 'New board', accel: 'Mod+N', run: () => C.run('file.new') },
          { icon: 'template', label: 'New from template…', run: () => C.run('file.templates') },
          { icon: 'open', label: 'Open…', accel: 'Mod+O', run: () => C.run('file.open') },
          { separator: true },
          { icon: 'save', label: 'Save', accel: 'Mod+S', run: () => C.run('file.save') },
          { icon: 'save', label: 'Save as…', accel: 'Mod+Shift+S', run: () => C.run('file.saveAs') },
          { icon: 'export', label: 'Export…', accel: 'Mod+E', run: () => C.run('file.exportPanel') },
          { icon: 'printer', label: 'Print…', accel: 'Mod+P', run: () => C.run('file.print') },
          { separator: true },
          { icon: 'image', label: 'Insert image…', run: () => C.run('file.import') },
          { icon: 'history', label: 'Board history…', run: () => C.run('file.backups') },
          { separator: true },
          { icon: 'command', label: 'Command palette', accel: 'Mod+K', run: () => C.run('help.palette') },
          { icon: 'keyboard', label: 'Keyboard shortcuts', accel: 'F1', run: () => C.run('help.shortcuts') },
          { icon: 'settings', label: 'Canvas & background…', run: () => C.run('view.background') },
          { separator: true },
          { icon: 'crown', label: L.isPaid() ? 'Licence' : 'Upgrade to Pro', run: () => C.run('account.upgrade') },
          { icon: 'help', label: 'About ' + IK.BRAND.name, run: () => C.run('help.about') }
        ], { align: 'left' });
      }
    });

    const title = el('button', {
      class: 'doc-chip', type: 'button', title: 'Rename this board',
      onclick: () => {
        const name = prompt('Board name', store.documentName());
        if (name) {
          store.doc().title = name;
          store.state.fileName = null;
          store.markDirty();
          updateDocChip();
        }
      }
    }, [
      el('span', { class: 'doc-chip__name', id: 'doc-name', text: 'Untitled' }),
      el('span', { class: 'doc-chip__state', id: 'doc-state', text: '' })
    ]);

    host.appendChild(el('div', { class: 'panel panel--row' }, [menuBtn, title]));
    return host;
  }

  function updateDocChip() {
    const name = U.$('#doc-name');
    const state = U.$('#doc-state');
    if (!name) return;
    name.textContent = store.documentName();
    const dirty = st.dirty;
    state.textContent = dirty ? 'Unsaved' : (st.filePath || st.fileName ? 'Saved' : 'Not saved yet');
    state.classList.toggle('is-dirty', dirty);
    P.setTitle((dirty ? '● ' : '') + store.documentName() + ' — ' + IK.BRAND.name);
  }

  /* ------------------------------------------------------------------ */
  /*  Top right                                                          */
  /* ------------------------------------------------------------------ */

  function buildTopRight() {
    const host = el('div', { class: 'hud hud--top-right' });
    const panel = el('div', { class: 'panel panel--row' });

    const proBtn = el('button', {
      class: 'pro-badge', type: 'button', id: 'pro-badge',
      title: 'Licence status',
      onclick: () => C.run('account.upgrade')
    }, [el('span', { html: IK.icon('crown', 15) }), el('span', { id: 'pro-label', text: L.label() })]);
    panel.appendChild(proBtn);

    panel.appendChild(el('div', { class: 'sep' }));

    panel.appendChild(iconButton({
      icon: 'play', title: 'Present', accel: 'Shift+P',
      onclick: () => C.run('view.present')
    }));
    panel.appendChild(iconButton({
      icon: 'export', title: 'Export', accel: 'Mod+E',
      onclick: () => C.run('file.exportPanel')
    }));
    const themeBtn = iconButton({
      icon: st.ui.theme === 'dark' ? 'sun' : 'moon', title: 'Theme',
      onclick: (e) => {
        e.stopPropagation();
        IK.dialogs.popover(themeBtn, [
          { icon: 'sun', label: 'Light', run: () => store.emit('ui:theme', { theme: 'light' }) },
          { icon: 'moon', label: 'Dark', run: () => store.emit('ui:theme', { theme: 'dark' }) },
          { icon: 'settings', label: 'Match system', run: () => store.emit('ui:theme', { theme: 'system' }) },
          { separator: true },
          { icon: 'grid', label: 'Canvas background…', run: () => C.run('view.background') }
        ]);
      }
    });
    themeBtn.id = 'theme-btn';
    panel.appendChild(themeBtn);
    panel.appendChild(iconButton({
      icon: 'help', title: 'Shortcuts & help', accel: 'F1',
      onclick: () => C.run('help.shortcuts')
    }));

    host.appendChild(panel);
    return host;
  }

  /* ------------------------------------------------------------------ */
  /*  Pages                                                              */
  /* ------------------------------------------------------------------ */

  function buildPages() {
    const host = el('div', { class: 'hud hud--bottom-left', id: 'pages-host' });
    refreshPages(host);
    return host;
  }

  function refreshPages(hostArg) {
    const host = hostArg || U.$('#pages-host');
    if (!host) return;
    host.innerHTML = '';
    const doc = store.doc();
    if (st.ui.presenting || st.ui.panelsHidden) return;

    const panel = el('div', { class: 'panel panel--row pages' });
    doc.pages.forEach((page, i) => {
      panel.appendChild(el('button', {
        class: 'page-tab' + (i === doc.activePage ? ' is-active' : ''),
        type: 'button',
        text: page.name,
        title: page.name + ' — click to open, double-click to rename',
        onclick: () => { if (i !== store.doc().activePage) store.setPage(i); },
        ondblclick: () => { store.setPage(i); C.run('page.rename'); }
      }));
    });
    panel.appendChild(iconButton({
      icon: 'plus', title: 'Add page', size: 16,
      onclick: () => C.run('page.add')
    }));
    const menuBtn = iconButton({
      icon: 'more', title: 'Page options', size: 16,
      onclick: (e) => {
        e.stopPropagation();
        IK.dialogs.popover(menuBtn, [
          { icon: 'duplicate', label: 'Duplicate page', run: () => C.run('page.duplicate') },
          { icon: 'text', label: 'Rename page…', run: () => C.run('page.rename') },
          { icon: 'trash', label: 'Delete page', run: () => C.run('page.delete') }
        ], { up: true });
      }
    });
    panel.appendChild(menuBtn);
    host.appendChild(panel);
  }

  /* ------------------------------------------------------------------ */
  /*  Zoom bar + minimap                                                 */
  /* ------------------------------------------------------------------ */

  function buildZoomBar() {
    const host = el('div', { class: 'hud hud--bottom-right' });

    const mini = el('canvas', { id: 'minimap', width: 220, height: 150 });
    const miniWrap = el('div', { class: 'panel minimap' + (st.ui.minimap ? '' : ' is-hidden'), id: 'minimap-wrap' }, [mini]);
    mini.addEventListener('pointerdown', (e) => {
      const t = R.minimapTransform;
      if (!t) return;
      const rect = mini.getBoundingClientRect();
      const wx = ((e.clientX - rect.left) * (mini.width / rect.width) - t.ox) / t.scale;
      const wy = ((e.clientY - rect.top) * (mini.height / rect.height) - t.oy) / t.scale;
      store.lookAt({ x: wx, y: wy, w: 1, h: 1 }, { scale: st.camera.scale, animate: true, duration: 220 });
    });

    const bar = el('div', { class: 'panel panel--row zoombar' }, [
      iconButton({ icon: 'map', title: 'Minimap', accel: 'Mod+M', onclick: () => C.run('view.minimap') }),
      iconButton({ icon: 'fit', title: 'Zoom to fit', accel: 'Shift+1', onclick: () => C.run('view.zoomFit') }),
      el('div', { class: 'sep' }),
      iconButton({ icon: 'minus', title: 'Zoom out', accel: 'Mod+-', size: 16, onclick: () => C.run('view.zoomOut') }),
      el('button', { class: 'zoom-label', id: 'zoom-label', type: 'button', text: '100%', title: 'Reset zoom', onclick: () => C.run('view.zoomReset') }),
      iconButton({ icon: 'plus', title: 'Zoom in', accel: 'Mod+=', size: 16, onclick: () => C.run('view.zoomIn') })
    ]);

    host.appendChild(miniWrap);
    host.appendChild(bar);
    return host;
  }

  function updateZoom() {
    const label = U.$('#zoom-label');
    if (label) label.textContent = Math.round(st.camera.scale * 100) + '%';
    if (st.ui.minimap) R.paintMinimap(U.$('#minimap'));
  }

  /* ------------------------------------------------------------------ */
  /*  Mobile bar                                                         */
  /* ------------------------------------------------------------------ */

  function buildMobileBar() {
    const host = el('div', { class: 'hud hud--mobile', id: 'mobile-bar' });
    const panel = el('div', { class: 'panel panel--row mobilebar' });
    [
      ['select', 'select'], ['pen', 'pen'], ['marker', 'marker'], ['eraser', 'eraser'],
      ['note', 'note'], ['rect', 'rect'], ['arrow', 'arrow'], ['text', 'text']
    ].forEach(([tool, icon]) => {
      const b = iconButton({ icon, title: tool, onclick: () => store.setTool(tool) });
      b.dataset.tool = tool;
      panel.appendChild(b);
    });
    panel.appendChild(el('div', { class: 'sep' }));
    panel.appendChild(iconButton({ icon: 'undo', title: 'Undo', onclick: () => C.run('edit.undo') }));
    panel.appendChild(iconButton({ icon: 'palette', title: 'Style', onclick: () => document.body.classList.toggle('show-inspector') }));
    host.appendChild(panel);
    return host;
  }

  /* ------------------------------------------------------------------ */
  /*  Presentation bar                                                   */
  /* ------------------------------------------------------------------ */

  function buildPresentBar() {
    const host = el('div', { class: 'hud hud--present', id: 'present-bar' });
    const panel = el('div', { class: 'panel panel--row' }, [
      iconButton({ icon: 'chevronLeft', title: 'Previous', onclick: () => IK.present.prev() }),
      el('span', { class: 'present__count', id: 'present-count', text: '1 / 1' }),
      iconButton({ icon: 'chevronRight', title: 'Next', onclick: () => IK.present.next() }),
      el('div', { class: 'sep' }),
      iconButton({ icon: 'laser', title: 'Laser pointer', onclick: () => store.setTool(st.tool === 'laser' ? 'select' : 'laser') }),
      iconButton({ icon: 'close', title: 'Exit (Esc)', onclick: () => IK.present.stop() })
    ]);
    host.appendChild(panel);
    return host;
  }

  /* ------------------------------------------------------------------ */
  /*  Boot                                                               */
  /* ------------------------------------------------------------------ */

  UI.build = function () {
    root = el('div', { id: 'ui', class: 'ui' });

    root.appendChild(buildTopLeft());

    toolbarHost = el('div', { class: 'hud hud--top', id: 'toolbar-host' });
    root.appendChild(toolbarHost);

    root.appendChild(buildTopRight());

    inspectorHost = el('div', { class: 'hud hud--left is-hidden', id: 'inspector-host' });
    root.appendChild(inspectorHost);

    root.appendChild(buildPages());
    root.appendChild(buildZoomBar());
    root.appendChild(buildMobileBar());
    root.appendChild(buildPresentBar());

    document.body.appendChild(root);

    buildToolbar();
    refreshInspector();
    updateDocChip();
    updateZoom();

    /* --- reactions --- */
    store.on('tool', () => {
      U.$$('[data-tool]').forEach((b) => {
        b.classList.toggle('is-active',
          b.dataset.tool === st.tool ||
          (b.dataset.tool === 'more' && MORE_SHAPES.indexOf(st.tool) >= 0));
      });
      // The lock badges are decided by the painter from the live tool, so
      // there is nothing to set here — just ask for a repaint.
      refreshInspector();
      R.request();
    });
    store.on('selection', refreshInspector);
    // Undo / redo can change what the panel shows without changing the
    // selection, so rebuild it then too (never mid-drag, which would kill
    // the slider being dragged).
    store.on('change', (info) => {
      if (info && info.reason === 'history' && !liveBatch) refreshInspector();
    });
    store.on('style', () => { /* inspector is rebuilt by its own actions */ });
    store.on('dirty', updateDocChip);
    store.on('document', () => { updateDocChip(); refreshPages(); });
    store.on('page', () => { refreshPages(); updateDocChip(); });
    store.on('camera', updateZoom);
    store.on('change', U.throttle(() => { if (st.ui.minimap) R.paintMinimap(U.$('#minimap')); }, 180));
    store.on('license', () => {
      const label = U.$('#pro-label');
      if (label) label.textContent = L.label();
      const badge = U.$('#pro-badge');
      if (badge) badge.classList.toggle('is-pro', L.isPaid());
    });
    store.on('ui:theme', () => setTimeout(refreshInspector, 30));
    store.on('ui', () => {
      buildToolbar();
      refreshInspector();
      refreshPages();
      const mini = U.$('#minimap-wrap');
      if (mini) mini.classList.toggle('is-hidden', !st.ui.minimap);
      document.body.classList.toggle('panels-hidden', st.ui.panelsHidden);
      updateZoom();
    });

    document.addEventListener('pointermove', (e) => { UI.lastPointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
    // Safety net: if a slider drag ends without a change event, still close
    // its undo batch so later edits don't fold into it.
    window.addEventListener('pointerup', () => setTimeout(() => {
      if (liveBatch) { liveBatch = false; store.endBatch('style', true); }
    }, 60));
  };

  UI.refreshInspector = refreshInspector;
  UI.updateDocChip = updateDocChip;
  UI.refreshPages = refreshPages;
  UI.iconButton = iconButton;
  UI.swatches = swatches;
  UI.colorField = colorField;
  UI.rememberColor = rememberColor;
  UI.segmented = segmented;
  UI.slider = slider;
  UI.section = section;

  IK.ui = UI;
})(window.IK = window.IK || {});
