/* ------------------------------------------------------------------ *
 *  Presentation mode — step through frames full-screen.                *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const U = IK.util;
  const G = IK.geom;
  const R = IK.render;
  const store = IK.store;
  const st = store.state;

  const Pr = {};
  let frames = [];
  let index = 0;
  let restoreCamera = null;
  let restoreTool = 'select';

  function collectFrames() {
    return store.elements()
      .filter((el) => el.type === 'frame' && !el.hidden)
      .sort((a, b) => {
        const na = parseInt(String(a.name).replace(/\D+/g, ''), 10);
        const nb = parseInt(String(b.name).replace(/\D+/g, ''), 10);
        if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
        return (a.y - b.y) || (a.x - b.x);
      });
  }

  Pr.available = () => collectFrames().length > 0;

  Pr.start = function () {
    frames = collectFrames();
    if (!frames.length) {
      U.toast('Draw a frame first (F) — each frame becomes a slide', {
        action: { label: 'Add frames', run: () => IK.templates.insert('deck') }
      });
      return false;
    }
    restoreCamera = Object.assign({}, st.camera);
    restoreTool = st.tool;
    index = 0;
    st.ui.presenting = true;
    st.ui.readOnly = true;
    store.clearSelection();
    document.body.classList.add('presenting');
    store.emit('ui');
    Pr.go(0, { animate: false });
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    return true;
  };

  Pr.stop = function () {
    if (!st.ui.presenting) return;
    st.ui.presenting = false;
    st.ui.readOnly = false;
    document.body.classList.remove('presenting');
    store.setTool(restoreTool);
    if (restoreCamera) {
      Object.assign(st.camera, restoreCamera);
      store.emit('camera');
    }
    store.emit('ui');
    R.request();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };

  Pr.go = function (i, opts) {
    if (!frames.length) return;
    index = U.clamp(i, 0, frames.length - 1);
    const frame = frames[index];
    store.lookAt(G.aabb(frame), Object.assign({ padding: 24, maxScale: 8, animate: true, duration: 420 }, opts || {}));
    const counter = document.getElementById('present-count');
    if (counter) counter.textContent = (index + 1) + ' / ' + frames.length;
  };

  Pr.next = () => Pr.go(index + 1);
  Pr.prev = () => Pr.go(index - 1);
  Pr.isActive = () => st.ui.presenting;

  Pr.handleKey = function (e) {
    if (!st.ui.presenting) return false;
    if (e.key === 'Escape') { Pr.stop(); return true; }
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].indexOf(e.key) >= 0) { e.preventDefault(); Pr.next(); return true; }
    if (['ArrowLeft', 'PageUp', 'Backspace'].indexOf(e.key) >= 0) { e.preventDefault(); Pr.prev(); return true; }
    if (e.key.toLowerCase() === 'k') { store.setTool(st.tool === 'laser' ? 'select' : 'laser'); return true; }
    if (e.key === 'Home') { Pr.go(0); return true; }
    if (e.key === 'End') { Pr.go(frames.length - 1); return true; }
    return false;
  };

  store.on('request:present', () => (st.ui.presenting ? Pr.stop() : Pr.start()));

  IK.present = Pr;
})(window.IK = window.IK || {});
