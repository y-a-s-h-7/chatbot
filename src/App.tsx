import { useCallback, useEffect, useState } from 'react';
import { ChatView } from './components/chat/ChatView';
import { ModelPicker } from './components/chat/ModelPicker';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { Sidebar } from './components/layout/Sidebar';
import { Toasts } from './components/layout/Toasts';
import { TopBar } from './components/layout/TopBar';
import { KeyDialog } from './components/settings/KeyDialog';
import { SettingsDialog } from './components/settings/SettingsDialog';
import { completeOpenRouterConnect, isOpenRouterCallback, listenForNativeRedirects } from './lib/oauth';
import { getAvailability, modelKey } from './providers';
import { applyTheme, watchSystemTheme } from './lib/theme';
import { useNativeShell } from './hooks/useNativeShell';
import { keyStorageLabel } from './store/settingsStore';
import type { ProviderId } from './providers/providers';
import { isStreaming } from './store/liveStore';
import { useChatStore } from './store/chatStore';
import { useMemoryStore } from './store/memoryStore';
import { useModelStore } from './store/modelStore';
import { useSettingsStore } from './store/settingsStore';
import { toastError, toastSuccess } from './store/toastStore';

interface CredentialRequest {
  open: boolean;
  providerId: ProviderId | null;
  modelId: string | null;
}

export function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [credential, setCredential] = useState<CredentialRequest>({ open: false, providerId: null, modelId: null });

  const theme = useSettingsStore((state) => state.theme);
  const hydrateSettings = useSettingsStore((state) => state.hydrate);
  const setConnected = useSettingsStore((state) => state.setConnected);
  const setKey = useSettingsStore((state) => state.setKey);
  const hydrateChats = useChatStore((state) => state.hydrate);
  const hydrateMemory = useMemoryStore((state) => state.hydrate);
  const bootstrapModels = useModelStore((state) => state.bootstrap);

  // One-time boot: preferences, saved facts, catalog, conversations, then the
  // OAuth callback. Memory has to be in place before the first request, since it
  // is part of that request's system prompt.
  useEffect(() => {
    void (async () => {
      // Awaited, not fired and forgotten: remembered API keys come from the
      // platform secret store, and declaring a saved model unusable before its
      // key has loaded would switch the user's model for no reason.
      await hydrateSettings();
      hydrateMemory();
      void hydrateChats();
      await bootstrapModels();

      // A saved model can disappear (a free tier retires, a deployment changes),
      // and our own suggestion may be unreachable. Rather than fail on send, move
      // to the best model that is actually usable and say so. A model the user
      // picked on purpose is never second-guessed.
      const store = useModelStore.getState();
      const settings = useSettingsStore.getState();
      const saved = store.byId(settings.modelId);
      const savedUsable = saved ? getAvailability(saved).status === 'ready' : false;
      if (savedUsable || settings.modelSource === 'user') return;
      const fallback = store.bestDefaultModel();
      if (!fallback || fallback.id === settings.modelId) return;
      settings.setModel(modelKey(fallback), 'auto');
      toastError(
        saved ? 'Switched models' : 'That model is gone',
        `Now using ${fallback.label}. Change it any time with Ctrl/⌘ + K.`,
      );
    })();
  }, [hydrateSettings, hydrateMemory, bootstrapModels, hydrateChats]);

  useEffect(() => {
    applyTheme(theme);
    return watchSystemTheme(() => {
      if (useSettingsStore.getState().theme === 'system') applyTheme('system');
    });
  }, [theme]);

  /**
   * Finishing an OpenRouter connect. On the web the code arrives as a query
   * parameter on boot; in the desktop and Android shells it arrives as a deep
   * link, so both routes end up here.
   */
  const finishOpenRouterConnect = useCallback(
    async (redirectUrl?: string) => {
      try {
        const result = await completeOpenRouterConnect(redirectUrl);
        if (!result) return;
        await setKey('openrouter', result.key, true);
        setConnected('openrouter', true);
        toastSuccess('OpenRouter connected', `Your account key is saved in ${keyStorageLabel()}.`);
      } catch (error) {
        toastError('Could not connect OpenRouter', error instanceof Error ? error.message : 'Unknown error');
      }
    },
    [setConnected, setKey],
  );

  useEffect(() => {
    if (isOpenRouterCallback()) void finishOpenRouterConnect();

    let stopListening: (() => void) | null = null;
    let cancelled = false;
    void listenForNativeRedirects((url) => void finishOpenRouterConnect(url)).then((stop) => {
      // The effect may have been torn down while the listener was registering.
      if (cancelled) stop();
      else stopListening = stop;
    });

    return () => {
      cancelled = true;
      stopListening?.();
    };
  }, [finishOpenRouterConnect]);

  // Warm the lazy markdown chunk once the shell is up. Without this the first
  // reply briefly renders as plain text and then reflows into markdown.
  useEffect(() => {
    const timer = setTimeout(() => {
      void import('./components/markdown/Markdown');
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  /**
   * Android's back gesture. Anything open consumes the press; a reply in flight
   * is stopped rather than thrown away; only a bare chat screen exits the app,
   * which is what the platform expects.
   */
  const onBack = useCallback(() => {
    if (credential.open) {
      setCredential({ open: false, providerId: null, modelId: null });
      return true;
    }
    if (paletteOpen) {
      setPaletteOpen(false);
      return true;
    }
    if (settingsOpen) {
      setSettingsOpen(false);
      return true;
    }
    if (mobileMenuOpen) {
      setMobileMenuOpen(false);
      return true;
    }
    if (isStreaming()) {
      useChatStore.getState().stop();
      return true;
    }
    return false;
  }, [credential.open, paletteOpen, settingsOpen, mobileMenuOpen]);

  // Safe areas, the on-screen keyboard, the splash screen and the back button.
  // A no-op in a browser tab.
  useNativeShell({ onBack });

  // Global hotkeys: the app is fully usable without a mouse.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (key === 'b') {
        event.preventDefault();
        const store = useSettingsStore.getState();
        store.setSidebarCollapsed(!store.sidebarCollapsed);
      } else if (key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Offline awareness, so a failed send is explained before it happens.
  useEffect(() => {
    const onOffline = () =>
      toastError('You are offline', 'Sending will fail until the connection comes back. Your message stays in the box or in the chat.');
    const onOnline = () => toastSuccess('Back online', 'You can send again.');
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  return (
    <ErrorBoundary>
      <div className="relative flex h-full min-h-0 bg-canvas selectable">
        <a
          href="#composer"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-70 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-[var(--shadow-pop)]"
        >
          Skip to message box
        </a>

        <Sidebar
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TopBar
            onOpenMenu={() => setMobileMenuOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenModelPicker={() => setPaletteOpen(true)}
          />
          <ChatView
            onOpenModelPicker={() => setPaletteOpen(true)}
            onRequestKey={(providerId, modelId) => setCredential({ open: true, providerId, modelId })}
          />
        </main>

        <ModelPicker
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onNeedsCredential={(providerId, modelId) => setCredential({ open: true, providerId, modelId })}
        />

        <KeyDialog
          open={credential.open}
          providerId={credential.providerId}
          modelId={credential.modelId}
          onClose={() => setCredential({ open: false, providerId: null, modelId: null })}
        />

        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <Toasts />
      </div>
    </ErrorBoundary>
  );
}
