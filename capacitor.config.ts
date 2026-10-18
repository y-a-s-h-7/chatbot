import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android shell around the same `dist/` folder.
 *
 *   npm run cap:sync      → build the web bundle and copy it into android/
 *   npm run build:android → assembleDebug (+ bundleRelease when signing is set up)
 */
const config: CapacitorConfig = {
  appId: 'com.yash7.chatbot',
  appName: 'Chatbot',
  webDir: 'dist',
  backgroundColor: '#0b0b0d',
  android: {
    // Nothing here is loaded over cleartext http, so there is no reason to allow
    // mixed content. A local Ollama on http://10.0.2.2 still works because the
    // request is made by native code, not by the page.
    allowMixedContent: false,
    captureInput: false,
    webContentsDebuggingEnabled: false,
  },
  server: {
    // The default. Kept explicit because everything downstream assumes a secure
    // origin: IndexedDB, the model cache and `navigator.storage.persist()`.
    androidScheme: 'https',
  },
  plugins: {
    Keyboard: {
      // `resize` is iOS-only and is left at its default ('native'); on Android
      // the WebView resizes because the manifest asks for adjustResize, and
      // useNativeShell() keeps the composer in view when the keyboard opens.
      // Android-only workaround for the WebView refusing to resize when a
      // fullscreen activity is showing a keyboard.
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      // Held until React has painted, then hidden by useNativeShell(). Auto
      // hiding here would flash a white frame first.
      launchAutoHide: false,
      launchShowDuration: 0,
      backgroundColor: '#0b0b0d',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
      androidScaleType: 'CENTER_CROP',
    },
    // Deliberately off. Turning this on patches window.fetch globally, which
    // would send WebLLM's multi-hundred-megabyte weight downloads through a
    // bridge that buffers the whole body in memory. Our own transport calls
    // CapacitorHttp explicitly, per request, where it is needed.
    CapacitorHttp: {
      enabled: false,
    },
  },
};

export default config;
