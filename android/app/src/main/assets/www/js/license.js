/* ------------------------------------------------------------------ *
 *  Licensing — Free vs Pro.                                            *
 *                                                                      *
 *  Keys are verified offline: the key carries a tier, an expiry and a  *
 *  hash of the buyer's email, signed with an HMAC. `tools/keygen.js`   *
 *  mints keys with the same algorithm after a sale.                     *
 *                                                                      *
 *  A client-side check can always be patched out by a determined user;  *
 *  that is a deliberate trade (no server, no phone-home, no account).   *
 *  Move to a server check only when piracy actually costs you money.    *
 * ------------------------------------------------------------------ */
(function (IK) {
  'use strict';

  const U = IK.util;
  const P = IK.platform;
  const BRAND = IK.BRAND;

  /* ---- what Pro unlocks -------------------------------------------- */

  const LIMITS = {
    freePages: 3,
    freeTemplates: 5,
    freeExportScale: 2,
    trialDays: 14
  };

  const FEATURES = {
    'export.pdf': 'PDF export',
    'export.svg': 'SVG export',
    'export.hires': 'High-resolution export (3× and 4×)',
    'present': 'Presentation mode',
    'pages': 'More than ' + LIMITS.freePages + ' pages per board',
    'templates': 'The full template library',
    'history': 'Board history and backups',
    'theme': 'Custom canvas themes'
  };

  const SECRET = 'inkora-2f9a-signing-key-change-me';  // must match tools/keygen.js
  const EPOCH = Date.UTC(2020, 0, 1);
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  const L = {
    LIMITS,
    FEATURES,
    state: {
      tier: 'free',        // free | pro
      key: null,
      email: null,
      expires: 0,          // ms, 0 = perpetual
      firstRun: 0,
      verified: false
    }
  };

  /* ---- encoding helpers -------------------------------------------- */

  function base32Encode(bytes) {
    let bits = 0, value = 0, out = '';
    for (const b of bytes) {
      value = (value << 8) | b;
      bits += 8;
      while (bits >= 5) {
        out += B32[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
  }

  function base32Decode(str) {
    let bits = 0, value = 0;
    const out = [];
    for (const ch of str.toUpperCase()) {
      const idx = B32.indexOf(ch);
      if (idx < 0) continue;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    return new Uint8Array(out);
  }

  function emailHash(email) {
    const s = String(email || '').trim().toLowerCase();
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h >>>= 0;
    return [(h >>> 8) & 255, h & 255];
  }

  async function hmac(bytes) {
    const enc = new TextEncoder();
    if (window.crypto && window.crypto.subtle) {
      const key = await crypto.subtle.importKey('raw', enc.encode(SECRET),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', key, bytes);
      return new Uint8Array(sig);
    }
    // Fallback (http:// contexts have no SubtleCrypto): weaker, still bound.
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    const all = Array.from(enc.encode(SECRET)).concat(Array.from(bytes));
    all.forEach((b, i) => {
      h1 = Math.imul(h1 ^ b, 16777619) >>> 0;
      h2 = ((h2 << 5) - h2 + b * (i + 7)) >>> 0;
    });
    return new Uint8Array([h1 & 255, (h1 >>> 8) & 255, (h1 >>> 16) & 255, h2 & 255, (h2 >>> 8) & 255,
      (h2 >>> 16) & 255, (h1 ^ h2) & 255, ((h1 >>> 24) ^ (h2 >>> 24)) & 255]);
  }

  L.normalizeKey = function (key) {
    return String(key || '').toUpperCase().replace(/[^A-Z2-7]/g, '').replace(/^INKORA/, '');
  };

  /**
   * Validate a key against an email.
   * @returns {Promise<{ok:boolean, tier?:string, expires?:number, reason?:string}>}
   */
  L.validate = async function (key, email) {
    const raw = L.normalizeKey(key);
    if (raw.length < 16) return { ok: false, reason: 'That key looks too short.' };
    const bytes = base32Decode(raw);
    if (bytes.length < 10) return { ok: false, reason: 'That key is not valid.' };

    const payload = bytes.slice(0, 5);
    const sig = bytes.slice(5, 10);
    const eh = emailHash(email);
    if (payload[3] !== eh[0] || payload[4] !== eh[1]) {
      return { ok: false, reason: 'This key belongs to a different email address.' };
    }

    const message = new Uint8Array(payload.length + 32);
    message.set(payload, 0);
    const emailBytes = new TextEncoder().encode(String(email).trim().toLowerCase());
    message.set(emailBytes.slice(0, 32), payload.length);

    const mac = await hmac(message);
    for (let i = 0; i < 5; i++) {
      if (mac[i] !== sig[i]) return { ok: false, reason: 'That key is not valid.' };
    }

    const tier = payload[0] === 2 ? 'pro' : payload[0] === 1 ? 'plus' : 'free';
    const days = (payload[1] << 8) | payload[2];
    const expires = days === 0 ? 0 : EPOCH + days * 86400000;
    if (expires && expires < Date.now()) return { ok: false, reason: 'That key expired on ' + new Date(expires).toLocaleDateString() + '.' };
    return { ok: true, tier, expires };
  };

  L.activate = async function (key, email) {
    const res = await L.validate(key, email);
    if (!res.ok) return res;
    L.state.tier = res.tier === 'free' ? 'free' : 'pro';
    L.state.key = String(key).trim();
    L.state.email = String(email).trim();
    L.state.expires = res.expires;
    L.state.verified = true;
    P.set('license', { key: L.state.key, email: L.state.email });
    IK.store.emit('license', L.state);
    return res;
  };

  L.deactivate = function () {
    L.state.tier = 'free';
    L.state.key = null;
    L.state.email = null;
    L.state.expires = 0;
    P.set('license', null);
    IK.store.emit('license', L.state);
  };

  /* ---- trial -------------------------------------------------------- */

  L.trialDaysLeft = function () {
    if (!L.state.firstRun) return LIMITS.trialDays;
    const used = Math.floor((Date.now() - L.state.firstRun) / 86400000);
    return Math.max(0, LIMITS.trialDays - used);
  };

  L.inTrial = () => L.state.tier !== 'pro' && L.trialDaysLeft() > 0;
  L.isPro = () => L.state.tier === 'pro' || L.inTrial();
  L.isPaid = () => L.state.tier === 'pro';

  /** Does the current licence allow this feature? */
  L.allows = function (feature) {
    if (!FEATURES[feature]) return true;
    return L.isPro();
  };

  /**
   * Gate a feature. Returns true when allowed; otherwise shows the upgrade
   * sheet and returns false, so callers read as `if (!L.require('x')) return;`
   */
  L.require = function (feature) {
    if (L.allows(feature)) return true;
    IK.store.emit('upgrade:show', { feature, name: FEATURES[feature] || feature });
    return false;
  };

  L.label = function () {
    if (L.isPaid()) return 'Pro';
    if (L.inTrial()) return 'Trial · ' + L.trialDaysLeft() + 'd';
    return 'Free';
  };

  L.init = async function () {
    let first = P.get('firstRun', 0);
    if (!first) { first = Date.now(); P.set('firstRun', first); }
    L.state.firstRun = first;

    const saved = P.get('license', null);
    if (saved && saved.key && saved.email) {
      const res = await L.validate(saved.key, saved.email);
      if (res.ok) {
        L.state.tier = res.tier === 'free' ? 'free' : 'pro';
        L.state.key = saved.key;
        L.state.email = saved.email;
        L.state.expires = res.expires;
        L.state.verified = true;
      } else {
        P.set('license', null);
      }
    }
    IK.store.emit('license', L.state);
    return L.state;
  };

  IK.license = L;
})(window.IK = window.IK || {});
