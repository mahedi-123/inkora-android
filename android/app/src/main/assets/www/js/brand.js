/* ------------------------------------------------------------------ *
 *  Inkora — brand configuration                                       *
 *                                                                     *
 *  Everything that carries the product name lives here. Change these  *
 *  four or five lines and the whole app — window title, menus, file    *
 *  extension, upgrade dialog, exported file names — follows.          *
 * ------------------------------------------------------------------ */
(function (root, factory) {
  const BRAND = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = BRAND; // Electron main
  root.IK = root.IK || {};
  root.IK.BRAND = BRAND;                                                       // renderer
})(typeof window !== 'undefined' ? window : globalThis, function () {
  return {
    name: 'Inkora',
    tagline: 'An infinite canvas for thinking out loud.',
    version: '2.0.1',

    /** Reverse-DNS id used by the installer and the Android package. */
    appId: 'app.inkora.desktop',

    /** Native document format. Legacy `.novaboard` files still open. */
    ext: 'inkora',
    legacyExt: ['novaboard'],
    fileTypeName: 'Inkora board',

    /** Marketing / support surfaces. Swap for your real domain. */
    site: 'https://inkora.app',
    buyUrl: 'https://inkora.app/pro',
    docsUrl: 'https://inkora.app/docs',
    supportEmail: 'hello@inkora.app',

    /** Shown in the About box. */
    author: 'Mahedi',
    copyright: '© ' + new Date().getFullYear() + ' Inkora'
  };
});
