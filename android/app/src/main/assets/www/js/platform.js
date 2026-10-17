/* ------------------------------------------------------------------ *
 *  Platform adapter.                                                   *
 *                                                                      *
 *  The whole app is written against this one interface, so the exact    *
 *  same renderer runs as a desktop app (Electron), in a browser tab     *
 *  (PWA) and inside the Android WebView shell.                          *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const U = IK.util;
  const BRAND = IK.BRAND;

  const hasElectron = typeof window !== 'undefined' && !!window.inkora;
  const hasAndroid = typeof window !== 'undefined' && !!window.InkoraAndroid;

  /* ---- tiny IndexedDB key/value store (browser autosave) ----------- */

  const idb = (function () {
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('no idb'));
        const req = indexedDB.open('inkora', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbp;
    }
    return {
      async get(key) {
        try {
          const db = await open();
          return await new Promise((res, rej) => {
            const tx = db.transaction('kv', 'readonly').objectStore('kv').get(key);
            tx.onsuccess = () => res(tx.result === undefined ? null : tx.result);
            tx.onerror = () => rej(tx.error);
          });
        } catch (e) { return null; }
      },
      async set(key, value) {
        try {
          const db = await open();
          await new Promise((res, rej) => {
            const tx = db.transaction('kv', 'readwrite').objectStore('kv').put(value, key);
            tx.onsuccess = () => res();
            tx.onerror = () => rej(tx.error);
          });
          return true;
        } catch (e) { return false; }
      }
    };
  })();

  /* ---- settings (small, synchronous, everywhere) ------------------- */

  const SETTINGS_KEY = 'inkora.settings.v2';
  let settingsCache = null;

  function readSettings() {
    if (settingsCache) return settingsCache;
    try { settingsCache = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
    catch (e) { settingsCache = {}; }
    return settingsCache;
  }
  function writeSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsCache || {})); } catch (e) { /* private mode */ }
  }

  /* ---- helpers ----------------------------------------------------- */

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl).split(',');
    const mime = (/data:([^;]+)/.exec(parts[0]) || [])[1] || 'application/octet-stream';
    const bin = atob(parts[1] || '');
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }

  function browserDownload(name, blobOrDataUrl) {
    const blob = typeof blobOrDataUrl === 'string' ? dataUrlToBlob(blobOrDataUrl) : blobOrDataUrl;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { path: name };
  }

  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
      input.onchange = () => {
        const file = input.files && input.files[0];
        input.remove();
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve({ path: file.name, text: String(reader.result) });
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      };
      document.body.appendChild(input);
      input.click();
    });
  }

  /* ---- the adapter ------------------------------------------------- */

  const P = {
    kind: hasElectron ? 'desktop' : hasAndroid ? 'android' : 'web',
    isDesktop: hasElectron,
    isAndroid: hasAndroid,
    isWeb: !hasElectron && !hasAndroid,
    /** Coarse pointer => touch-first layout decisions. */
    isTouch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,

    /* --- documents -------------------------------------------------- */

    /** @returns {Promise<{path:string}|null>} */
    async saveDocument(text, filePath, suggestedName) {
      const name = suggestedName || 'Untitled.' + BRAND.ext;
      if (hasElectron) return window.inkora.saveFile(text, filePath, name);
      if (hasAndroid) {
        const ok = window.InkoraAndroid.saveText(name, text);
        return ok ? { path: name } : null;
      }
      // Browser: use the File System Access API when we have it, so "Save"
      // really overwrites the same file instead of dropping a numbered copy
      // into ~/Downloads every time.
      if (window.showSaveFilePicker) {
        try {
          let handle = filePath && P._handles.get(filePath);
          if (!handle) {
            handle = await window.showSaveFilePicker({
              suggestedName: name,
              types: [{ description: BRAND.fileTypeName, accept: { 'application/json': ['.' + BRAND.ext] } }]
            });
          }
          const w = await handle.createWritable();
          await w.write(text);
          await w.close();
          P._handles.set(handle.name, handle);
          return { path: handle.name };
        } catch (e) {
          if (e && e.name === 'AbortError') return null;
        }
      }
      return browserDownload(name, new Blob([text], { type: 'application/json' }));
    },

    _handles: new Map(),

    /** @returns {Promise<{path:string,text:string}|null>} */
    async openDocument() {
      if (hasElectron) return window.inkora.openFile();
      if (hasAndroid) {
        const raw = window.InkoraAndroid.openText();
        return raw ? JSON.parse(raw) : null;
      }
      if (window.showOpenFilePicker) {
        try {
          const [handle] = await window.showOpenFilePicker({
            types: [{
              description: BRAND.fileTypeName,
              accept: { 'application/json': ['.' + BRAND.ext].concat(BRAND.legacyExt.map((e) => '.' + e)) }
            }]
          });
          const file = await handle.getFile();
          P._handles.set(handle.name, handle);
          return { path: handle.name, text: await file.text() };
        } catch (e) {
          if (e && e.name === 'AbortError') return null;
        }
      }
      return pickFile('.' + BRAND.ext + ',' + BRAND.legacyExt.map((e) => '.' + e).join(',') + ',.json');
    },

    /** Write a binary artefact (PNG/SVG/PDF). `data` is a data URL or Blob. */
    async saveBinary(defaultName, data, mime) {
      if (hasElectron) {
        const dataUrl = typeof data === 'string' ? data : await blobToDataUrl(data);
        const target = await window.inkora.exportDialog(defaultName);
        if (!target) return null;
        const ok = await window.inkora.writeBinary(target, dataUrl);
        return ok ? { path: target } : null;
      }
      if (hasAndroid) {
        const dataUrl = typeof data === 'string' ? data : await blobToDataUrl(data);
        const ok = window.InkoraAndroid.saveBinary(defaultName, dataUrl);
        return ok ? { path: defaultName } : null;
      }
      if (window.showSaveFilePicker) {
        try {
          const ext = '.' + (defaultName.split('.').pop() || 'png');
          const handle = await window.showSaveFilePicker({
            suggestedName: defaultName,
            types: [{ description: ext.slice(1).toUpperCase(), accept: { [mime || 'application/octet-stream']: [ext] } }]
          });
          const w = await handle.createWritable();
          await w.write(typeof data === 'string' ? dataUrlToBlob(data) : data);
          await w.close();
          return { path: handle.name };
        } catch (e) {
          if (e && e.name === 'AbortError') return null;
        }
      }
      return browserDownload(defaultName, data);
    },

    /* --- autosave --------------------------------------------------- */

    async autosave(text) {
      if (hasElectron) return window.inkora.autosave(text);
      if (hasAndroid) return window.InkoraAndroid.autosave(text);
      return idb.set('autosave', text);
    },

    async loadAutosave() {
      if (hasElectron) return window.inkora.loadAutosave();
      if (hasAndroid) return window.InkoraAndroid.loadAutosave();
      return idb.get('autosave');
    },

    /** Rolling backups so a bad save is never fatal. */
    async backup(text) {
      if (hasElectron) return window.inkora.backup(text);
      const list = (await idb.get('backups')) || [];
      list.unshift({ at: Date.now(), text });
      await idb.set('backups', list.slice(0, 10));
      return true;
    },

    async listBackups() {
      if (hasElectron) return window.inkora.listBackups();
      const list = (await idb.get('backups')) || [];
      return list.map((b, i) => ({ id: String(i), at: b.at, size: b.text.length }));
    },

    async readBackup(id) {
      if (hasElectron) return window.inkora.readBackup(id);
      const list = (await idb.get('backups')) || [];
      const item = list[Number(id)];
      return item ? item.text : null;
    },

    /* --- settings & licence ----------------------------------------- */

    get(key, fallback) {
      const s = readSettings();
      return key in s ? s[key] : fallback;
    },

    set(key, value) {
      const s = readSettings();
      s[key] = value;
      writeSettings();
      if (hasElectron && window.inkora.setSetting) window.inkora.setSetting(key, value);
      return value;
    },

    /* --- chrome ----------------------------------------------------- */

    setTitle(title) {
      document.title = title;
      if (hasElectron) window.inkora.setTitle(title);
      if (hasAndroid && window.InkoraAndroid.setTitle) window.InkoraAndroid.setTitle(title);
    },

    attention() {
      if (hasElectron) window.inkora.flashFrame();
      if (hasAndroid && window.InkoraAndroid.vibrate) window.InkoraAndroid.vibrate(220);
    },

    haptic(ms) {
      if (hasAndroid && window.InkoraAndroid.vibrate) window.InkoraAndroid.vibrate(ms || 12);
      else if (navigator.vibrate) { try { navigator.vibrate(ms || 12); } catch (e) { /* ignore */ } }
    },

    openExternal(url) {
      if (hasElectron) window.inkora.openExternal(url);
      else window.open(url, '_blank', 'noopener');
    },

    /** Ask the shell to confirm before closing with unsaved work. */
    setDirty(isDirty) {
      if (hasElectron && window.inkora.setDirty) window.inkora.setDirty(isDirty);
    },

    print() {
      if (hasElectron && window.inkora.print) window.inkora.print();
      else window.print();
    },

    /* --- events from the shell -------------------------------------- */

    onMenu(cb) { if (hasElectron) window.inkora.onMenu(cb); },
    onSaveAndClose(cb) { if (hasElectron && window.inkora.onSaveAndClose) window.inkora.onSaveAndClose(cb); },
    saveAndCloseDone(ok) { if (hasElectron && window.inkora.saveAndCloseDone) window.inkora.saveAndCloseDone(ok); },
    nativeEdit(action) { if (hasElectron && window.inkora.nativeEdit) window.inkora.nativeEdit(action); },
    onOpenFile(cb) { if (hasElectron) window.inkora.onOpenFile(cb); },
    onBeforeQuit(cb) { if (hasElectron && window.inkora.onBeforeQuit) window.inkora.onBeforeQuit(cb); },
    async startupFile() { return hasElectron ? window.inkora.startupFile() : null; },

    /* --- clipboard -------------------------------------------------- */

    async writeClipboardText(text) {
      try { await navigator.clipboard.writeText(text); return true; }
      catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
        ta.remove();
        return ok;
      }
    },

    async readClipboardText() {
      try { return await navigator.clipboard.readText(); } catch (e) { return null; }
    },

    /** An image on the system clipboard, as a Blob, or null. */
    async readClipboardImage() {
      try {
        if (!navigator.clipboard || !navigator.clipboard.read) return null;
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((t) => t.indexOf('image/') === 0);
          if (type) return await item.getType(type);
        }
      } catch (e) { /* permission denied or unsupported */ }
      return null;
    },

    async writeClipboardImage(blob) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
      } catch (e) { return false; }
    }
  };

  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(blob);
    });
  }

  P.dataUrlToBlob = dataUrlToBlob;
  P.blobToDataUrl = blobToDataUrl;

  IK.platform = P;
})(window.IK = window.IK || {});
