# Desktop (Windows) and Android builds

Both shells wrap the **same `dist/` folder** the web build produces. There is no
second app: the React code, the providers, the chat store and the UI are shared,
and the shells add four things the browser cannot give them — a real origin, an
unrestricted HTTP stack, OS-level secret storage, and somewhere to live outside a
tab.

```
npm run dev              web app on http://localhost:5173 (unchanged)
npm run electron:dev     the same app in an Electron window, with HMR
npm run build            web build                       → dist/
npm run build:desktop    desktop build (free tier off)    → dist/
npm run build:win        NSIS installer + portable .exe   → release/
npm run cap:sync         android build + copy into android/
npm run build:android    debug .apk (+ signed .aab when configured)
npm run icons            regenerate every icon and splash asset
npm run android:patch    re-apply the Android project patches (idempotent)
```

## What was added

| Path | Purpose |
| --- | --- |
| `electron/main.cjs` | Main process: `app://` renderer, streaming HTTP over IPC, `safeStorage`, deep links. |
| `electron/preload.cjs` | The entire trust boundary: four narrow APIs, context isolation on. |
| `electron/lib/window-state.cjs` | Remembered size/position, validated against the displays that exist. |
| `electron-builder.yml` | NSIS installer + portable build, deep-link registration, asar. |
| `capacitor.config.ts` | appId, app name, scheme, keyboard and splash behaviour. |
| `scripts/electron-dev.mjs` | Vite + Electron, one command, waits for the server before loading. |
| `scripts/build-android.mjs` | Web build → `cap sync` → Gradle, with a signing check. |
| `scripts/patch-android.mjs` | Manifest, Gradle, icons, network policy. Safe to re-run. |
| `scripts/generate-icons.mjs` | Draws every icon with `node:zlib` — no image dependency. |
| `src/lib/native/platform.ts` | Which shell are we in, synchronously. |
| `src/lib/native/http.ts` | The adaptive transport: web fetch / Electron IPC / Capacitor HTTP. |
| `src/lib/native/pacing.ts` | Frame-by-frame reveal for the buffered Android transport. |
| `src/lib/native/secrets.ts` | Where a remembered API key actually lives. |
| `src/lib/native/deeplink.ts` | System browser + `chatbot://oauth/callback` for sign-in. |
| `src/hooks/useNativeShell.ts` | Safe areas, keyboard, splash, back button. |

## How requests reach providers

Browsers enforce CORS; native shells do not have to.

| Shell | API calls | Streaming |
| --- | --- | --- |
| Web | `fetch` from the page | real, token by token |
| Electron | IPC to the main process, which uses Chromium's network stack | real: chunks are forwarded as they arrive |
| Android | `fetch` first, since it streams for real; a provider that refuses the WebView origin is replayed once through Capacitor's native HTTP, and that host is remembered for the session | real in the common case; buffered responses are revealed frame by frame so the UI still streams |

Only `https://` (or local HTTP) ever leaves the app, and keys go into headers, not
URLs. Nothing logs a key, a header or a body: the main process redacts anything
key-shaped before putting a message on the wire to the renderer.

## Prerequisites (Windows)

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20 LTS or newer | 22 recommended. `node -v` |
| JDK | **21** | Capacitor 7.6.9 generates `JavaVersion.VERSION_21` source/target, so JDK 17 will not compile. Android Studio's bundled JBR 21 is the easiest way to get it. |
| Android Studio | Ladybug (2024.2) or newer | Includes the SDK manager and the emulator. |
| Android SDK | Platform 35 + Build-Tools 35 | Installed from Android Studio → SDK Manager. |
| Gradle | not needed | The wrapper in `android/` fetches Gradle 8.11.1 (AGP 8.7.2). |

Set `JAVA_HOME` and `ANDROID_HOME` if Gradle cannot find them:

```powershell
setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
```

> **Install scripts:** recent npm versions block lifecycle scripts by default. If
> Electron's binary is missing after `npm install` (the app starts and says so),
> approve it once:
>
> ```
> npm approve-scripts electron
> ```
>
> or run `node node_modules/electron/install.js`.

## Windows: installer and portable build

```powershell
npm install
npm run build:win
```

Artifacts, in `release/`:

| File | What it is |
| --- | --- |
| `Chatbot-1.0.0-x64.exe` | NSIS installer. Creates a Start Menu entry, a desktop shortcut, and registers the `chatbot://` protocol so sign-in can return to the app. |
| `Chatbot-1.0.0-portable.exe` | Single-file portable build. Nothing is installed. |

Useful variants:

```powershell
npm run build:win:dir        # unpacked folder in release/win-unpacked, for a quick look
npm run electron:dev         # develop against the Vite server with hot reload
$env:CHATBOT_DEVTOOLS="1"; npm run electron:dev   # with DevTools attached
```

Where things end up on the machine after install: the app in
`%LOCALAPPDATA%\Programs\Chatbot`, and chats, settings and the encrypted key file
in `%APPDATA%\Chatbot`. Uninstalling keeps that folder — conversations are not
deleted behind your back.

## Android: APK for testing, AAB for release

One-time setup of the platform (already committed in this repo, so normally you
can skip it):

```powershell
npx cap add android
npm run icons
npm run android:patch
```

Build:

```powershell
npm run build:android
```

Artifacts:

| File | What it is |
| --- | --- |
| `android/app/build/outputs/apk/debug/app-debug.apk` | Debug APK, signed with the debug key. Install it with `adb install -r <path>`. |
| `android/app/build/outputs/bundle/release/app-release.aab` | Signed release bundle for Google Play. Only produced once a signing key exists. |

### Creating a signing key (once)

```powershell
keytool -genkeypair -v -keystore chatbot-release.keystore -alias chatbot `
  -keyalg RSA -keysize 2048 -validity 10000
```

Move `chatbot-release.keystore` somewhere outside the repository (it is
git-ignored, but treat it as a secret), then create
`android/keystore.properties`:

```properties
storeFile=/absolute/path/to/chatbot-release.keystore
storePassword=…
keyAlias=chatbot
keyPassword=…
```

`npm run build:android` picks that file up automatically and adds `bundleRelease`.
If you prefer environment variables, `CHATBOT_KEYSTORE` and
`CHATBOT_KEYSTORE_PASSWORD` are also checked before it decides to skip.

> Losing the keystore means you can never update the app on Play again. Back it up.
> Keep `keystore.properties` and the keystore out of git — both are ignored.

### Building in Android Studio instead

```powershell
npm run cap:sync      # must run before an Android Studio build: the web assets live in the ignored assets folder
npm run cap:open      # opens android/ in Android Studio
```

## Sign-in from a native shell

OAuth cannot run in an embedded webview (Google blocks it, and a webview would see
your provider password), so sign-in leaves the app:

1. the app opens the consent page in the system browser / a Custom Tab,
2. the provider redirects to `chatbot://oauth/callback?code=…`,
3. the OS hands that URL back to the app (registered protocol on Windows, intent
   filter on Android) and the app exchanges the code for a key.

The PKCE verifier is held in session storage on the web and in the platform secret
store on a native shell, because an app can be killed while the browser is in
front. Override the redirect with `VITE_OAUTH_REDIRECT` if you would rather use a
verified HTTPS App Link (`https://your-domain/callback` plus
`.well-known/assetlinks.json`), which is the recommended production setup.

## Where secrets live

| Shell | Remembered API keys |
| --- | --- |
| Windows desktop | `safeStorage` (DPAPI), encrypted file in `%APPDATA%\Chatbot\secrets.json`, `0600` |
| Android | Android Keystore via `@aparajita/capacitor-secure-storage` (AES-GCM, key never leaves the keystore) |
| Web | `localStorage` — a browser has nowhere safer, and Settings says so |

Keys are never written into the preferences blob. Older builds did write them
there, so on first launch any key found in `chatbot.settings.v1` is moved into the
secret store and the blob is rewritten without it.

## Test checklist

Desktop and Android, in order:

- [ ] **Installs and starts** — the installer completes; the app opens on the chat screen with no white flash.
- [ ] **Window** — resize and move, close, reopen: the size and position come back. Minimise, restore, maximise.
- [ ] **Offline history** — turn off networking, reopen: conversations are still listed and readable.
- [ ] **API key** — Settings → Providers → paste a Gemini key → *Test key* → "Key accepted" → the key shows masked, and asking a question streams an answer.
- [ ] **Remember toggle** — On: the key survives a full restart. Off: restarting asks for a key again. (Desktop: check `%APPDATA%\Chatbot\secrets.json` exists and contains no readable key. Android: the file is in app-private storage and is encrypted.)
- [ ] **Model switching mid-chat** — switch models with a conversation open; the new model answers with the same history, and the earlier replies still show which model wrote them.
- [ ] **In-browser model** — pick a small in-browser model; the first use downloads once, later uses say "Loading … from the local cache".
- [ ] **Stop / regenerate** — Stop during a stream ends it promptly, keeps the partial text, and never leaves a spinner behind.
- [ ] **Sign in** — Connect OpenRouter: the system browser opens, and returning lands back in the app with the key saved.
- [ ] **Android: back button** — with Settings open, back closes it; during a stream, back stops the stream; on the chat screen, back exits the app.
- [ ] **Android: keyboard** — focus the composer: the layout shrinks and the box stays visible above the keyboard.
- [ ] **Android: safe areas** — on a notched device, no content hides under the status bar or the gesture bar. Rotate: the layout follows.
- [ ] **Android: offline** — airplane mode: history still opens, and a send fails with a clear message rather than a spinner.
- [ ] **No secrets in logs** — open DevTools/logcat and look for a key; there must be none.

## Known limitations

- **The Electron binary and the Android SDK cannot be installed in every
  environment.** Everything in this repository is verified by typecheck, 115 unit
  tests (including the preload bridge contract and the key-storage invariant), the
  web/desktop/android builds, and the `app://`-equivalent web path; the packaged
  `.exe` and the `.apk` themselves were not built here. Run `npm run build:win`
  and `npm run build:android` on your machine to produce them.
- **Android responses are buffered** when a provider refuses the WebView origin.
  The reply is then revealed frame by frame, so it still streams visually, but the
  first token appears only after the provider has finished. A small custom OkHttp
  plugin would restore true streaming in that case.
- **A custom `chatbot://` redirect is a registered scheme, not a claimed App
  Link.** If a provider rejects a non-https redirect, set `VITE_OAUTH_REDIRECT` to
  an https App Link on a domain you control.
- **In-browser models on Android** depend on WebGPU support in the WebView and on
  enough GPU memory; the small models in the picker are the realistic ones.
- **No code signing certificate for Windows**, so SmartScreen will warn on first
  run until the installer is signed with a real certificate (`win.certificateFile`).
- **iOS is not set up.** The web bundle and the Capacitor config would carry over,
  but there is no `ios/` platform, no App Store identifiers and no Apple
  prerequisites here.
- **The free tier does not exist in the native builds** (there is no same-origin
  server behind them), so `.env.desktop` / `.env.android` switch it off and the
  picker marks it unavailable instead of offering a model that can never answer.
