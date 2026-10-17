# Inkora for Android

A thin WebView shell around the same renderer the desktop app uses, so there is
only ever one copy of the whiteboard code to maintain.

## Build

```bash
npm run sync:android      # copies src/renderer -> app/src/main/assets/www
cd android
./gradlew assembleDebug   # or assembleRelease once you have a keystore
```

The APK lands in `app/build/outputs/apk/`.

`app/src/main/assets/www/` is generated — it is in `.gitignore`, and
`sync:android` recreates it. Never edit files there; edit `src/renderer`.

## Launcher icons

Drop `ic_launcher.png` / `ic_launcher_round.png` into `app/src/main/res/mipmap-*`
(48, 72, 96, 144, 192 px). Android Studio's Image Asset tool generates all five
sizes from one square PNG. Without them the build will fail on the manifest's
icon reference.

## How the web app talks to the phone

`window.InkoraAndroid` is injected by `MainActivity.Bridge` and mirrors the
desktop bridge:

| JS call | What happens |
|---|---|
| `autosave(text)` / `loadAutosave()` | Private app storage |
| `saveText(name, text)` | System "save as" sheet |
| `openText()` | System file picker (result comes back asynchronously) |
| `saveBinary(name, dataUrl)` | Writes a PNG/PDF/SVG into Downloads |
| `vibrate(ms)`, `setTitle(t)` | Haptics, window title |

The renderer detects Android via `window.InkoraAndroid` in
`src/renderer/js/platform.js` and switches one-finger drawing to one-finger
panning by default (change it in Canvas settings).
