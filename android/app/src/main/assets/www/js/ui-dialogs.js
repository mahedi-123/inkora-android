/* ------------------------------------------------------------------ *
 *  Dialogs, popovers, the command palette and the context menu.        *
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
  const T = IK.templates;
  const X = IK.exporters;
  const BRAND = IK.BRAND;
  const el = U.el;
  const st = store.state;

  const D = {};
  let openModal = null;
  let openPopover = null;

  /* ------------------------------------------------------------------ */
  /*  Modal shell                                                        */
  /* ------------------------------------------------------------------ */

  D.close = function () {
    D.closeFloating();
    if (openModal) {
      openModal.classList.add('is-closing');
      const node = openModal;
      setTimeout(() => node.remove(), 140);
      openModal = null;
      document.body.classList.remove('modal-open');
    }
  };

  /**
   * Close a specific dialog, and only if it is still the open one.
   * A delayed close ("thanks!" then dismiss) must never take out a dialog
   * the user opened in the meantime.
   */
  D.closeIf = function (node) {
    if (node && openModal === node) D.close();
  };

  D.isOpen = () => !!openModal;
  D.current = () => openModal;

  D.modal = function (opts) {
    D.close();
    D.closePopover();
    const body = el('div', { class: 'modal__body' }, opts.content);
    const card = el('div', {
      class: 'modal' + (opts.size ? ' modal--' + opts.size : ''),
      role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Dialog'
    }, [
      el('div', { class: 'modal__head' }, [
        el('div', { class: 'modal__title' }, [
          opts.icon ? el('span', { class: 'modal__icon', html: IK.icon(opts.icon, 18) }) : null,
          el('span', { text: opts.title || '' })
        ]),
        el('button', { class: 'btn modal__close', type: 'button', title: 'Close', html: IK.icon('close', 18), onclick: D.close })
      ]),
      body,
      opts.footer ? el('div', { class: 'modal__foot' }, opts.footer) : null
    ]);

    const back = el('div', {
      class: 'modal-backdrop',
      onpointerdown: (e) => { if (e.target === back && opts.dismissable !== false) D.close(); }
    }, [card]);

    // Remove any backdrop still fading out, so stale nodes can never be
    // found by a query — or closed by a timer aimed at the previous dialog.
    U.$$('.modal-backdrop.is-closing').forEach((n) => n.remove());

    document.body.appendChild(back);
    document.body.classList.add('modal-open');
    openModal = back;
    setTimeout(() => {
      const focusable = card.querySelector('input, button:not(.modal__close), select, textarea');
      if (focusable) focusable.focus();
    }, 30);
    return { root: back, card, body, close: D.close };
  };

  /* ------------------------------------------------------------------ */
  /*  Popover menu                                                       */
  /* ------------------------------------------------------------------ */

  D.closePopover = function () {
    if (openPopover) { openPopover.remove(); openPopover = null; }
  };

  D.popover = function (anchor, items, opts) {
    D.closePopover();
    D.closeFloating();
    opts = opts || {};
    const menu = el('div', { class: 'popover', role: 'menu' });

    items.forEach((item) => {
      if (item.separator) { menu.appendChild(el('div', { class: 'popover__sep' })); return; }
      const disabled = item.when && !item.when();
      const b = el('button', {
        class: 'popover__item' + (item.checked && item.checked() ? ' is-checked' : ''),
        type: 'button', role: 'menuitem', disabled: disabled || undefined,
        onclick: () => { D.closePopover(); if (!disabled) item.run(); }
      }, [
        el('span', { class: 'popover__icon', html: item.icon ? IK.icon(item.icon, 16) : '' }),
        el('span', { class: 'popover__label', text: item.label }),
        item.accel ? el('span', { class: 'popover__accel', text: U.prettyKeys(item.accel) }) : null,
        item.pro && !L.isPro() ? el('span', { class: 'popover__pro', html: IK.icon('crown', 13) }) : null
      ]);
      menu.appendChild(b);
    });

    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, top: anchor.y, bottom: anchor.y, right: anchor.x, width: 0, height: 0 };
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = opts.align === 'left' ? rect.left : rect.right - mw;
    let top = (opts.up || rect.bottom + mh > window.innerHeight - 8) ? rect.top - mh - 8 : rect.bottom + 8;
    if (anchor.getBoundingClientRect === undefined) { left = rect.left; top = rect.top; }
    menu.style.left = U.clamp(left, 8, Math.max(8, window.innerWidth - mw - 8)) + 'px';
    menu.style.top = U.clamp(top, 8, Math.max(8, window.innerHeight - mh - 8)) + 'px';

    openPopover = menu;
    setTimeout(() => {
      const onDown = (e) => {
        if (menu.contains(e.target)) return;
        D.closePopover();
        document.removeEventListener('pointerdown', onDown, true);
      };
      document.addEventListener('pointerdown', onDown, true);
    }, 0);
    return menu;
  };

  /* ------------------------------------------------------------------ */
  /*  Floating panel — a popover that holds controls rather than a menu   */
  /* ------------------------------------------------------------------ */

  let openFloating = null;

  D.closeFloating = function () {
    if (openFloating) {
      if (openFloating.__off) openFloating.__off();
      openFloating.remove();
      openFloating = null;
    }
  };

  D.floating = function (anchor, content, opts) {
    D.closeFloating();
    opts = opts || {};
    const panel = el('div', { class: 'popover popover--panel' }, [content]);
    if (opts.width) panel.style.width = opts.width + 'px';
    document.body.appendChild(panel);

    const rect = anchor.getBoundingClientRect();
    const pw = panel.offsetWidth, ph = panel.offsetHeight;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, rect.top - ph - 8);
    if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';

    const onDown = (e) => { if (!panel.contains(e.target) && e.target !== anchor) D.closeFloating(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); D.closeFloating(); } };
    setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
    document.addEventListener('keydown', onKey, true);
    panel.__off = () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };

    openFloating = panel;
    return panel;
  };

  /* ------------------------------------------------------------------ */
  /*  Context menu                                                       */
  /* ------------------------------------------------------------------ */

  store.on('contextmenu', ({ x, y, element }) => {
    const has = st.selection.length > 0;
    const items = [];

    // Getting back out of a lock must never depend on hitting a thin stroke
    // exactly, so offer the specific unlock when we have the element and a
    // blanket one whenever anything on the board is locked.
    if (element && element.locked) {
      items.push({
        icon: 'unlock', label: 'Unlock', run: () => {
          store.update(element.id, { locked: false });
          store.setSelection([element.id]);
        }
      });
    }
    if (store.elements().some((e) => e.locked)) {
      items.push({ icon: 'unlock', label: 'Unlock everything', run: () => C.run('edit.unlockAll') });
    }
    if (items.length) items.push({ separator: true });

    if (has) {
      items.push(
        { icon: 'copy', label: 'Copy', accel: 'Mod+C', run: () => C.run('edit.copy') },
        { icon: 'duplicate', label: 'Duplicate', accel: 'Mod+D', run: () => C.run('edit.duplicate') },
        { icon: 'trash', label: 'Delete', accel: 'Delete', run: () => C.run('edit.delete') },
        { separator: true },
        { icon: 'front', label: 'Bring to front', run: () => C.run('order.front') },
        { icon: 'back', label: 'Send to back', run: () => C.run('order.back') },
        { separator: true },
        { icon: 'group', label: 'Group', accel: 'Mod+G', when: () => st.selection.length > 1, run: () => C.run('edit.group') },
        { icon: 'ungroup', label: 'Ungroup', when: () => store.selected().some((e) => e.groupId), run: () => C.run('edit.ungroup') },
        { icon: 'lock', label: 'Lock', run: () => C.run('edit.lock') },
        { icon: 'grid', label: 'Tidy up into a grid', accel: 'Mod+Shift+A', when: () => C.get('arrange.tidy').when(), run: () => C.run('arrange.tidy') },
        { separator: true },
        { icon: 'mindmap', label: 'Add connected node', accel: 'Tab', when: () => st.selection.length === 1, run: () => C.run('insert.mindNode') },
        { icon: 'download', label: 'Export selection…', run: () => D.exportSheet({ selectionOnly: true }) }
      );
    } else {
      items.push(
        { icon: 'copy', label: 'Paste', accel: 'Mod+V', run: () => C.run('edit.paste') },
        { icon: 'select', label: 'Select all', accel: 'Mod+A', run: () => C.run('edit.selectAll') },
        { separator: true },
        { icon: 'template', label: 'Insert a template…', run: () => D.templates({ insert: true }) },
        { icon: 'image', label: 'Insert image…', run: () => C.run('file.import') },
        { separator: true },
        { icon: 'grid', label: 'Canvas & background…', run: () => D.background() },
        { icon: 'fit', label: 'Zoom to fit', run: () => C.run('view.zoomFit') }
      );
    }
    D.popover({ x, y, left: x, top: y, right: x, bottom: y }, items, { align: 'left' });
  });

  /* ------------------------------------------------------------------ */
  /*  Command palette                                                    */
  /* ------------------------------------------------------------------ */

  D.palette = function () {
    const input = el('input', {
      class: 'palette__input', type: 'text', placeholder: 'Type a command…',
      autocomplete: 'off', spellcheck: 'false'
    });
    const list = el('div', { class: 'palette__list', role: 'listbox' });
    let items = [];
    let active = 0;

    const GROUP_ORDER = ['File', 'Edit', 'Insert', 'Tools', 'View', 'Arrange', 'Pages', 'Help'];
    const groupRank = (g) => {
      const i = GROUP_ORDER.indexOf(g);
      return i < 0 ? GROUP_ORDER.length : i;
    };

    function render(query) {
      const scored = C.list
        .filter((cmd) => !cmd.hidden)
        .map((cmd) => ({ cmd, score: query ? U.fuzzy(query, cmd.title + ' ' + cmd.group) : 0 }))
        .filter((r) => r.score >= 0)
        .sort((a, b) => (query
          ? (b.score - a.score || groupRank(a.cmd.group) - groupRank(b.cmd.group))
          : (groupRank(a.cmd.group) - groupRank(b.cmd.group))));

      items = scored.slice(0, 60);
      active = 0;
      list.innerHTML = '';
      if (!items.length) {
        list.appendChild(el('div', { class: 'palette__empty', text: 'Nothing matches “' + query + '”' }));
        return;
      }
      items.forEach((r, i) => {
        const enabled = !r.cmd.when || r.cmd.when();
        list.appendChild(el('button', {
          class: 'palette__item' + (i === 0 ? ' is-active' : '') + (enabled ? '' : ' is-disabled'),
          type: 'button',
          onclick: () => { D.close(); C.run(r.cmd.id); }
        }, [
          el('span', { class: 'palette__icon', html: IK.icon(r.cmd.icon || 'command', 16) }),
          el('span', { class: 'palette__title', text: r.cmd.title }),
          r.cmd.pro && !L.isPro() ? el('span', { class: 'palette__pro', html: IK.icon('crown', 13) }) : null,
          el('span', { class: 'palette__group', text: r.cmd.group }),
          r.cmd.accel ? el('span', { class: 'palette__accel', text: U.prettyKeys(r.cmd.accel) }) : null
        ]));
      });
    }

    function move(delta) {
      const nodes = U.$$('.palette__item', list);
      if (!nodes.length) return;
      nodes[active] && nodes[active].classList.remove('is-active');
      active = (active + delta + nodes.length) % nodes.length;
      nodes[active].classList.add('is-active');
      nodes[active].scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', () => render(input.value.trim()));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const r = items[active];
        if (r) { D.close(); C.run(r.cmd.id); }
      } else if (e.key === 'Escape') { D.close(); }
    });

    render('');
    D.modal({
      title: 'Command palette', icon: 'command', size: 'palette',
      content: [el('div', { class: 'palette' }, [input, list])]
    });
  };

  /* ------------------------------------------------------------------ */
  /*  Templates gallery                                                  */
  /* ------------------------------------------------------------------ */

  D.templates = function (opts) {
    opts = opts || {};
    const grid = el('div', { class: 'tpl-grid' });
    let index = 0;

    T.groups().forEach((list, group) => {
      grid.appendChild(el('div', { class: 'tpl-group', text: group }));
      const row = el('div', { class: 'tpl-row' });
      list.forEach((tpl) => {
        const locked = index >= L.LIMITS.freeTemplates && !L.isPro();
        index++;
        row.appendChild(el('button', {
          class: 'tpl-card' + (locked ? ' is-locked' : ''), type: 'button',
          onclick: () => {
            if (locked && !L.require('templates')) return;
            D.close();
            if (opts.insert) T.insert(tpl.id);
            else store.emit('request:newFromTemplate', { id: tpl.id });
          }
        }, [
          el('div', { class: 'tpl-card__art', html: templateArt(tpl.id) }),
          el('div', { class: 'tpl-card__name' }, [
            el('span', { text: tpl.name }),
            locked ? el('span', { class: 'tpl-card__pro', html: IK.icon('crown', 13) }) : null
          ]),
          el('div', { class: 'tpl-card__desc', text: tpl.description })
        ]));
      });
      grid.appendChild(row);
    });

    D.modal({
      title: opts.insert ? 'Insert a template' : 'Start a new board',
      icon: 'template', size: 'wide',
      content: [grid]
    });
  };

  /** Little inline SVG previews so the gallery isn't a wall of text. */
  function templateArt(id) {
    const box = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}"/>`;
    const art = {
      blank: box(6, 6, 108, 60, 'var(--tpl-2)'),
      kanban: [0, 1, 2, 3].map((i) => box(8 + i * 27, 8, 22, 56, i === 0 ? 'var(--tpl-2)' : 'var(--tpl-1)')).join('') ,
      retro: [0, 1, 2, 3].map((i) => box(8 + i * 27, 8, 22, 56, ['#c3fae8', '#ffc9c9', '#ffe9a8', '#c5e3ff'][i])).join(''),
      swot: [0, 1, 2, 3].map((i) => box(10 + (i % 2) * 52, 8 + Math.floor(i / 2) * 30, 48, 26, ['#c3fae8', '#ffc9c9', '#c5e3ff', '#ffd8a8'][i])).join(''),
      lean: [0, 1, 2, 3, 4].map((i) => box(8 + i * 21, 8, 18, 36, 'var(--tpl-1)')).join('') + box(8, 48, 104, 16, 'var(--tpl-2)'),
      flow: `${box(46, 6, 28, 14, 'var(--tpl-1)')}<path d="M60 20v10M60 44v10" stroke="var(--tpl-line)" stroke-width="2"/>${box(46, 30, 28, 14, 'var(--tpl-2)')}<path d="M60 54l14 8-14 8-14-8z" fill="var(--tpl-1)"/>`,
      mindmap: `<circle cx="60" cy="36" r="14" fill="var(--tpl-2)"/>${[0, 1, 2, 3].map((i) => box(i < 2 ? 8 : 90, 12 + (i % 2) * 34, 22, 16, 'var(--tpl-1)')).join('')}<path d="M46 36L30 20M46 36L30 54M74 36l16-16M74 36l16 18" stroke="var(--tpl-line)" stroke-width="2"/>`,
      week: [0, 1, 2, 3, 4].map((i) => box(6 + i * 22, 8, 18, 56, 'var(--tpl-1)')).join(''),
      brainstorm: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => box(10 + (i % 4) * 26, 12 + Math.floor(i / 4) * 26, 22, 22, ['#ffe9a8', '#c5e3ff', '#c3fae8', '#ffd8a8'][i % 4])).join(''),
      story: [0, 1, 2, 3].map((i) => box(10 + i * 26, 8, 22, 12, '#c5e3ff') + box(10 + i * 26, 24, 22, 18, '#ffe9a8') + box(10 + i * 26, 46, 22, 18, '#ffe9a8')).join(''),
      empathy: [0, 1, 2, 3].map((i) => box(10 + (i % 2) * 52, 8 + Math.floor(i / 2) * 30, 48, 26, ['#c5e3ff', '#e5dbff', '#c3fae8', '#ffd8a8'][i])).join('') + '<circle cx="60" cy="36" r="12" fill="#fff" stroke="var(--tpl-line)"/>',
      deck: [0, 1, 2, 3].map((i) => box(10 + (i % 2) * 52, 8 + Math.floor(i / 2) * 30, 48, 26, 'var(--tpl-1)')).join('')
    };
    return `<svg viewBox="0 0 120 72" width="100%" height="100%">${art[id] || art.blank}</svg>`;
  }

  /* ------------------------------------------------------------------ */
  /*  Export sheet                                                       */
  /* ------------------------------------------------------------------ */

  D.exportSheet = function (preset) {
    preset = preset || {};
    const opts = {
      format: 'png',
      scale: 2,
      transparent: false,
      selectionOnly: !!preset.selectionOnly && st.selection.length > 0,
      withBackgroundPattern: false,
      pdfMode: 'board'
    };

    const preview = el('div', { class: 'export__preview' });
    const info = el('div', { class: 'export__info' });

    function refresh() {
      const els = opts.selectionOnly && st.selection.length ? store.selected() : store.elements();
      const box = els.length ? G.aabbOf(els) : { w: 1200, h: 800 };
      const w = Math.round((box.w + 64) * opts.scale);
      const h = Math.round((box.h + 64) * opts.scale);
      info.textContent = els.length
        ? `${els.length} element${els.length === 1 ? '' : 's'} · ${w} × ${h} px`
        : 'This page is empty';
      preview.innerHTML = '';
      if (els.length && opts.format !== 'pdf') {
        try {
          const { canvas } = X.renderToCanvas({
            scale: Math.min(1, 520 / Math.max(1, box.w)),
            transparent: opts.transparent,
            selectionOnly: opts.selectionOnly,
            padding: 24
          });
          canvas.className = 'export__canvas';
          preview.appendChild(canvas);
        } catch (e) { /* preview is optional */ }
      } else {
        preview.appendChild(el('div', { class: 'export__placeholder', html: IK.icon('export', 34) }));
      }
    }

    const formatRow = IK.ui.segmented([
      { value: 'png', label: 'PNG' },
      { value: 'jpg', label: 'JPG' },
      { value: 'svg', label: 'SVG' },
      { value: 'pdf', label: 'PDF' }
    ], opts.format, (v) => {
      if ((v === 'svg' && !L.require('export.svg')) || (v === 'pdf' && !L.require('export.pdf'))) return;
      opts.format = v;
      body.replaceWith(build());
    });

    let body;
    function build() {
      const scaleRow = IK.ui.segmented([
        { value: 1, label: '1×' }, { value: 2, label: '2×' },
        { value: 3, label: '3×' }, { value: 4, label: '4×' }
      ], opts.scale, (v) => {
        if (v > L.LIMITS.freeExportScale && !L.require('export.hires')) return;
        opts.scale = v;
        refresh();
        body.replaceWith(build());
      });

      const checks = el('div', { class: 'export__checks' }, [
        checkbox('Transparent background', opts.transparent, (v) => { opts.transparent = v; refresh(); }),
        checkbox('Only the selection', opts.selectionOnly, (v) => { opts.selectionOnly = v; refresh(); }, st.selection.length === 0),
        opts.format === 'png' || opts.format === 'jpg'
          ? checkbox('Include the background pattern', opts.withBackgroundPattern, (v) => { opts.withBackgroundPattern = v; })
          : null
      ]);

      const pdfRow = opts.format === 'pdf'
        ? IK.ui.section('PDF contents', [IK.ui.segmented([
          { value: 'board', label: 'This page' },
          { value: 'pages', label: 'All pages' },
          { value: 'frames', label: 'Each frame' }
        ], opts.pdfMode, (v) => { opts.pdfMode = v; body.replaceWith(build()); })])
        : null;

      body = el('div', { class: 'export' }, [
        preview,
        el('div', { class: 'export__controls' }, [
          IK.ui.section('Format', [formatRow]),
          opts.format === 'svg' || opts.format === 'pdf' ? null : IK.ui.section('Size', [scaleRow]),
          pdfRow,
          IK.ui.section('Options', [checks]),
          info
        ])
      ]);
      return body;
    }

    function checkbox(label, value, onChange, disabled) {
      const input = el('input', { type: 'checkbox', checked: value || undefined, disabled: disabled || undefined, onchange: (e) => onChange(e.target.checked) });
      return el('label', { class: 'check' + (disabled ? ' is-disabled' : '') }, [input, el('span', { text: label })]);
    }

    const modal = D.modal({
      title: 'Export board', icon: 'export', size: 'wide',
      content: [build()],
      footer: [
        el('button', { class: 'btn-ghost', type: 'button', text: 'Copy to clipboard', onclick: () => C.run('export.clipboard') }),
        el('button', {
          class: 'btn-primary', type: 'button', text: 'Export',
          onclick: () => { D.close(); store.emit('request:export', Object.assign({}, opts)); }
        })
      ]
    });
    refresh();
    return modal;
  };

  /* ------------------------------------------------------------------ */
  /*  Search                                                             */
  /* ------------------------------------------------------------------ */

  D.search = function () {
    const input = el('input', { class: 'palette__input', type: 'text', placeholder: 'Find text on every page…', autocomplete: 'off' });
    const list = el('div', { class: 'palette__list' });

    function render(q) {
      list.innerHTML = '';
      if (!q) {
        list.appendChild(el('div', { class: 'palette__empty', text: 'Type to search notes, labels and text.' }));
        return;
      }
      // Every page is searched; matches on the open page come first.
      const needle = q.toLowerCase();
      const doc = store.doc();
      const hits = [];
      const order = doc.pages.map((p, i) => i).sort((a, b) => (a === doc.activePage ? -1 : b === doc.activePage ? 1 : a - b));
      order.forEach((pi) => {
        doc.pages[pi].elements.forEach((e) => {
          const txt = (M.textOf(e) + ' ' + (e.type === 'frame' ? (e.name || '') : '')).trim();
          if (txt && txt.toLowerCase().indexOf(needle) >= 0) hits.push({ el: e, page: pi, txt });
        });
      });
      if (!hits.length) {
        list.appendChild(el('div', { class: 'palette__empty', text: 'No matches on any page.' }));
        return;
      }
      const many = doc.pages.length > 1;
      hits.slice(0, 80).forEach((h) => {
        const hit = h.el;
        list.appendChild(el('button', {
          class: 'palette__item', type: 'button',
          onclick: () => {
            D.close();
            if (h.page !== store.doc().activePage) store.setPage(h.page);
            const live = store.byId(hit.id);
            if (!live) return;
            if (!live.locked && !live.hidden) store.setSelection([live.id]);
            store.lookAt(G.expand(G.aabb(live), 160), { animate: true, maxScale: 1.6 });
          }
        }, [
          el('span', { class: 'palette__icon', html: IK.icon(hit.type === 'note' ? 'note' : hit.type === 'frame' ? 'frame' : 'text', 16) }),
          el('span', { class: 'palette__title', text: h.txt.slice(0, 90) }),
          el('span', { class: 'palette__group', text: many ? doc.pages[h.page].name : hit.type })
        ]));
      });
    }

    input.addEventListener('input', () => render(input.value.trim()));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') D.close();
      if (e.key === 'Enter') { const first = list.querySelector('.palette__item'); if (first) first.click(); }
    });
    render('');
    D.modal({ title: 'Find on board', icon: 'search', size: 'palette', content: [el('div', { class: 'palette' }, [input, list])] });
  };

  /* ------------------------------------------------------------------ */
  /*  Background / canvas settings                                       */
  /* ------------------------------------------------------------------ */

  D.background = function () {
    const page = store.page();
    const content = el('div', { class: 'settings' }, [
      IK.ui.section('Pattern', [IK.ui.segmented([
        { value: 'dots', label: 'Dots' },
        { value: 'grid', label: 'Grid' },
        { value: 'lines', label: 'Lines' },
        { value: 'iso', label: 'Iso' },
        { value: 'blank', label: 'Blank' }
      ], page.background, (v) => {
        store.mutate(() => { store.page().background = v; }, 'background');
        R.request();
        D.background();
      })]),
      IK.ui.section('Canvas colour', [
        IK.ui.colorField({
          role: 'canvas',
          value: page.canvasColor || null,
          auto: { label: 'Match theme', value: null },
          onPick: (c) => {
            if (c !== null && !L.require('theme')) return;
            store.mutate(() => { store.page().canvasColor = c; }, 'canvas');
            R.request();
            IK.ui.refreshInspector();
          }
        })
      ]),
      IK.ui.section('Behaviour', [
        toggleRow('Smart alignment guides', st.ui.snap, () => C.run('view.snap')),
        toggleRow('Snap to grid', st.ui.gridSnap, () => C.run('view.grid')),
        toggleRow('Snap rough sketches to clean shapes', st.ui.autoShape, () => C.run('view.autoShape')),
        toggleRow('Rescue colours that are invisible on this canvas', st.ui.rescueContrast, () => {
          st.ui.rescueContrast = !st.ui.rescueContrast;
          P.set('rescueContrast', st.ui.rescueContrast);
          store.emit('ui');
          IK.ui.refreshInspector();
          R.request();
        }),
        toggleRow('Keep the tool selected after drawing', st.ui.lockTool, () => C.run('tool.lockToggle')),
        IK.platform.isTouch || IK.platform.isAndroid
          ? toggleRow('One finger pans instead of drawing', st.ui.touchPan, () => {
            st.ui.touchPan = !st.ui.touchPan; P.set('touchPan', st.ui.touchPan); store.emit('ui');
          }) : null
      ])
    ]);

    D.modal({ title: 'Canvas', icon: 'settings', content: [content] });
  };

  function toggleRow(label, value, onToggle) {
    const input = el('input', {
      type: 'checkbox', checked: value || undefined,
      onchange: () => { onToggle(); }
    });
    return el('label', { class: 'check check--row' }, [input, el('span', { text: label })]);
  }

  /* ------------------------------------------------------------------ */
  /*  Shortcuts                                                          */
  /* ------------------------------------------------------------------ */

  D.shortcuts = function () {
    const groups = new Map();
    C.list.forEach((cmd) => {
      if (!cmd.accel) return;
      if (!groups.has(cmd.group)) groups.set(cmd.group, []);
      groups.get(cmd.group).push(cmd);
    });

    const cols = el('div', { class: 'keys' });
    groups.forEach((cmds, group) => {
      cols.appendChild(el('div', { class: 'keys__group' }, [
        el('h4', { text: group })
      ].concat(cmds.map((cmd) => el('div', { class: 'keys__row' }, [
        el('span', { text: cmd.title }),
        el('kbd', { text: U.prettyKeys(cmd.accel) })
      ])))));
    });

    cols.appendChild(el('div', { class: 'keys__group' }, [
      el('h4', { text: 'Canvas' }),
      row('Pan', 'Scroll, or hold Space'),
      row('Zoom', U.modKeyLabel + ' + scroll, or pinch'),
      row('Pan while drawing', 'Middle-drag'),
      row('Constrain / square', 'Hold Shift'),
      row('Draw from the centre', 'Hold Alt'),
      row('Duplicate while dragging', 'Hold Alt'),
      row('Move a frame with its contents', 'Drag the frame'),
      row('Elbow / curved connectors', 'Arrow style in the side panel'),
      row('Select touching elements', 'Alt + drag a marquee'),
      row('Edit text', 'Double-click'),
      row('Nudge selection', 'Arrow keys (Shift = 10×)'),
      row('Insert image', 'Drop a file, or paste')
    ]));

    function row(label, keys) {
      return el('div', { class: 'keys__row' }, [el('span', { text: label }), el('kbd', { text: keys })]);
    }

    D.modal({ title: 'Keyboard shortcuts', icon: 'keyboard', size: 'wide', content: [cols] });
  };

  /* ------------------------------------------------------------------ */
  /*  About                                                              */
  /* ------------------------------------------------------------------ */

  D.about = function () {
    D.modal({
      title: 'About ' + BRAND.name, icon: 'board',
      content: [el('div', { class: 'about' }, [
        el('div', { class: 'about__logo', html: IK.icon('board', 40) }),
        el('h3', { text: BRAND.name + ' ' + BRAND.version }),
        el('p', { text: BRAND.tagline }),
        el('p', { class: 'about__meta', text: 'Your boards stay on this device. No account, no telemetry, no cloud.' }),
        el('p', { class: 'about__meta', text: BRAND.copyright }),
        el('div', { class: 'about__links' }, [
          el('button', { class: 'btn-ghost', type: 'button', text: 'Website', onclick: () => P.openExternal(BRAND.site) }),
          el('button', { class: 'btn-ghost', type: 'button', text: 'Keyboard shortcuts', onclick: () => D.shortcuts() })
        ])
      ])]
    });
  };

  /* ------------------------------------------------------------------ */
  /*  Upgrade / licence                                                  */
  /* ------------------------------------------------------------------ */

  D.upgrade = function (ctx) {
    ctx = ctx || {};
    const keyInput = el('input', { class: 'field', type: 'text', placeholder: 'INKORA-XXXX-XXXX-XXXX-XXXX', autocomplete: 'off' });
    const emailInput = el('input', { class: 'field', type: 'email', placeholder: 'The email you bought with', autocomplete: 'off' });
    const message = el('div', { class: 'upgrade__msg' });

    const features = Object.keys(L.FEATURES).map((k) => el('li', { text: L.FEATURES[k] }));

    async function activate() {
      message.className = 'upgrade__msg';
      message.textContent = 'Checking…';
      const res = await L.activate(keyInput.value, emailInput.value);
      if (res.ok) {
        message.className = 'upgrade__msg is-ok';
        message.textContent = 'Thank you — Pro is active on this device.';
        U.toast('Pro unlocked');
        const mine = D.current();
        setTimeout(() => D.closeIf(mine), 900);
      } else {
        message.className = 'upgrade__msg is-error';
        message.textContent = res.reason || 'That key could not be verified.';
      }
    }

    const status = L.isPaid()
      ? el('div', { class: 'upgrade__status is-ok' }, [
        el('strong', { text: 'Pro is active' }),
        el('span', { text: L.state.email ? ' · ' + L.state.email : '' }),
        el('button', { class: 'btn-ghost', type: 'button', text: 'Remove licence', onclick: () => { L.deactivate(); D.close(); U.toast('Licence removed'); } })
      ])
      : L.inTrial()
        ? el('div', { class: 'upgrade__status' }, [el('strong', { text: L.trialDaysLeft() + ' days left in your trial' })])
        : el('div', { class: 'upgrade__status' }, [el('strong', { text: 'You are on the free version' })]);

    D.modal({
      title: L.isPaid() ? 'Your licence' : 'Upgrade to ' + BRAND.name + ' Pro',
      icon: 'crown', size: 'wide',
      content: [el('div', { class: 'upgrade' }, [
        el('div', { class: 'upgrade__left' }, [
          status,
          ctx.name ? el('p', { class: 'upgrade__ctx', text: ctx.name + ' is a Pro feature.' }) : null,
          el('ul', { class: 'upgrade__list' }, features),
          el('p', { class: 'about__meta', text: 'One payment, no subscription. Works offline, on this device, forever.' }),
          el('button', {
            class: 'btn-primary', type: 'button', text: 'Buy a licence',
            onclick: () => P.openExternal(BRAND.buyUrl)
          })
        ]),
        el('div', { class: 'upgrade__right' }, [
          el('h4', { text: 'Already bought?' }),
          emailInput, keyInput, message,
          el('button', { class: 'btn-primary', type: 'button', text: 'Activate', onclick: activate })
        ])
      ])]
    });
    if (ctx.activate) setTimeout(() => emailInput.focus(), 60);
  };

  /* ------------------------------------------------------------------ */
  /*  Backups                                                            */
  /* ------------------------------------------------------------------ */

  D.backups = async function () {
    const list = el('div', { class: 'backups' }, [el('div', { class: 'palette__empty', text: 'Loading…' })]);
    D.modal({ title: 'Board history', icon: 'history', content: [list] });

    const items = (await P.listBackups()) || [];
    list.innerHTML = '';
    if (!items.length) {
      list.appendChild(el('div', { class: 'palette__empty', text: 'No snapshots yet. ' + BRAND.name + ' keeps one every few minutes while you work.' }));
      return;
    }
    items.forEach((b) => {
      list.appendChild(el('div', { class: 'backups__row' }, [
        el('span', { class: 'backups__when', text: new Date(b.at).toLocaleString() }),
        el('span', { class: 'backups__size', text: U.formatBytes(b.size || 0) }),
        el('button', {
          class: 'btn-ghost', type: 'button', text: 'Restore',
          onclick: async () => {
            const text = await P.readBackup(b.id);
            if (!text) return U.toast('That snapshot could not be read');
            D.close();
            store.emit('request:openText', { text, name: 'Restored board' });
          }
        })
      ]));
    });
  };

  /* ------------------------------------------------------------------ */
  /*  Welcome                                                            */
  /* ------------------------------------------------------------------ */

  D.welcome = function () {
    const start = (id) => { D.close(); P.set('seenWelcome', true); if (id) T.startNew(id); };
    D.modal({
      title: 'Welcome to ' + BRAND.name, icon: 'sparkle', size: 'wide', dismissable: true,
      content: [el('div', { class: 'welcome' }, [
        el('p', { class: 'welcome__lede', text: BRAND.tagline }),
        el('div', { class: 'welcome__grid' }, [
          card('Blank canvas', 'Start with nothing but space.', 'board', () => start('blank')),
          card('Kanban board', 'Track work in four columns.', 'grid', () => start('kanban')),
          card('Mind map', 'Grow ideas with Tab.', 'mindmap', () => start('mindmap')),
          card('Flowchart', 'Boxes and arrows that stay connected.', 'flow', () => start('flow'))
        ]),
        el('div', { class: 'welcome__tips' }, [
          tip('Everything is a keystroke away — press ' + U.prettyKeys('Mod+K') + ' for the command palette.'),
          tip('Draw a rough box or circle and it snaps to a clean shape.'),
          tip('Your work saves itself. Nothing leaves this device.')
        ])
      ])],
      footer: [el('button', { class: 'btn-primary', type: 'button', text: 'Start drawing', onclick: () => start(null) })]
    });

    function card(title, desc, icon, onclick) {
      return el('button', { class: 'welcome__card', type: 'button', onclick }, [
        el('span', { class: 'welcome__icon', html: IK.icon(icon, 24) }),
        el('strong', { text: title }),
        el('span', { text: desc })
      ]);
    }
    function tip(text) {
      return el('div', { class: 'welcome__tip' }, [el('span', { html: IK.icon('sparkle', 15) }), el('span', { text })]);
    }
  };

  /* ------------------------------------------------------------------ */
  /*  Wiring                                                             */
  /* ------------------------------------------------------------------ */

  store.on('ui:palette', () => D.palette());
  store.on('ui:templates', (o) => D.templates(o));
  store.on('ui:export', () => D.exportSheet());
  store.on('ui:shortcuts', () => D.shortcuts());
  store.on('ui:about', () => D.about());
  store.on('ui:search', () => D.search());
  store.on('ui:background', () => D.background());
  store.on('ui:backups', () => D.backups());
  store.on('upgrade:show', (ctx) => D.upgrade(ctx));

  IK.dialogs = D;
})(window.IK = window.IK || {});
