import { useEffect, useRef } from 'react';
import { isNativeShell, shellKind } from '../lib/native/platform';

export interface NativeShellOptions {
  /**
   * Called when Android's back gesture or button is pressed. Return true when
   * something in the UI consumed it (a dialog closed); return false to let the
   * app exit, which is what the platform expects at the root screen.
   */
  onBack?: () => boolean;
}

/**
 * Everything a browser does for free and a native shell does not: safe-area
 * insets, the on-screen keyboard resizing the viewport, the splash screen, and
 * the hardware back button.
 *
 * All of it is a no-op on the web, and every plugin import is lazy, so none of
 * this lands in the browser bundle.
 */
export function useNativeShell(options: NativeShellOptions = {}): void {
  const onBackRef = useRef(options.onBack);
  onBackRef.current = options.onBack;

  // The viewport, not the window: Android reports the keyboard-free height
  // through visualViewport, which is what the layout has to match.
  useEffect(() => {
    if (!isNativeShell()) return;
    const root = document.documentElement;
    root.classList.add('native-shell');

    const measure = () => {
      const viewport = window.visualViewport;
      const height = viewport ? viewport.height : window.innerHeight;
      if (height > 0) root.style.setProperty('--app-height', `${Math.round(height)}px`);
    };

    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);

    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
      root.classList.remove('native-shell');
      root.style.removeProperty('--app-height');
    };
  }, []);

  // Android: the manifest asks for adjustResize, and this keeps the composer in
  // view when the keyboard covers where the user was typing.
  useEffect(() => {
    if (shellKind() !== 'android') return;
    let teardown = () => {};
    let cancelled = false;

    void (async () => {
      try {
        const { Keyboard } = await import('@capacitor/keyboard');
        const shown = await Keyboard.addListener('keyboardWillShow', () => {
          const composer = document.getElementById('composer');
          if (composer && document.activeElement === composer.querySelector('textarea')) {
            composer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        });
        if (cancelled) {
          void shown.remove();
          return;
        }
        teardown = () => void shown.remove();
      } catch {
        /* plugin unavailable: adjustResize still handles the layout */
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, []);

  // Android: back closes whatever is open, then leaves the app.
  useEffect(() => {
    if (shellKind() !== 'android') return;
    let teardown = () => {};
    let cancelled = false;

    void (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('backButton', () => {
          if (onBackRef.current?.()) return;
          void App.exitApp();
        });
        if (cancelled) {
          void handle.remove();
          return;
        }
        teardown = () => void handle.remove();
      } catch {
        /* plugin unavailable: the WebView keeps its default history behaviour */
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, []);

  // Android: hold the splash until React has painted its first frame, so the
  // first thing the user sees is the app rather than a white flash.
  useEffect(() => {
    if (shellKind() !== 'android') return;
    const timer = setTimeout(() => {
      void import('@capacitor/splash-screen')
        .then(({ SplashScreen }) => SplashScreen.hide())
        .catch(() => {});
    }, 60);
    return () => clearTimeout(timer);
  }, []);
}
