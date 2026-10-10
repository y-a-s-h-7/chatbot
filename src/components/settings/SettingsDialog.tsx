import { useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import { PROVIDER_ORDER } from '../../providers';
import { storageMode } from '../../lib/storage';
import { useChatStore } from '../../store/chatStore';
import { useSettingsStore } from '../../store/settingsStore';
import { toastSuccess } from '../../store/toastStore';
import type { ThemeMode } from '../../lib/theme';
import { Button, Field, Switch } from '../ui/controls';
import { Dialog, ConfirmDialog } from '../ui/Dialog';
import { MoonIcon, SystemIcon, SunIcon } from '../icons';
import { ProviderCard } from './ProviderCard';

type Tab = 'providers' | 'chat' | 'appearance' | 'data';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'providers', label: 'Providers' },
  { id: 'chat', label: 'Chat' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'data', label: 'Data & privacy' },
];

export function SettingsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [tab, setTab] = useState<Tab>('providers');
  const [confirmClear, setConfirmClear] = useState(false);

  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const autoScroll = useSettingsStore((state) => state.autoScroll);
  const setAutoScroll = useSettingsStore((state) => state.setAutoScroll);
  const systemPrompt = useSettingsStore((state) => state.systemPrompt);
  const setSystemPrompt = useSettingsStore((state) => state.setSystemPrompt);
  const temperature = useSettingsStore((state) => state.temperature);
  const setTemperature = useSettingsStore((state) => state.setTemperature);
  const resetEverything = useSettingsStore((state) => state.resetEverything);

  const metas = useChatStore((state) => state.metas);
  const messages = useChatStore((state) => state.messages);
  const clearEverything = useChatStore((state) => state.clearEverything);

  const messageCount = useMemo(
    () => Object.values(messages).reduce((total, list) => total + list.length, 0),
    [messages],
  );
  const storedKeyCount = useSettingsStore((state) => Object.keys(state.keys).length);

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Settings"
        description="Everything here stays on this device."
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted">
              Keys are only ever sent to the provider you got them from.
            </p>
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </div>
        }
      >
        <div className="flex gap-1 border-b border-line px-4 pt-3">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? 'page' : undefined}
              className={cn(
                'relative rounded-t-lg px-3 py-2 text-[13px] font-medium transition-colors',
                tab === item.id ? 'text-fg' : 'text-muted hover:text-fg',
              )}
            >
              {item.label}
              {tab === item.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </div>

        <div className="space-y-4 px-4 py-5">
          {tab === 'providers' && (
            <>
              <p className="text-[13px] leading-relaxed text-muted">
                One app, every provider. Paste a key for the ones you use, connect OpenRouter in one click, or use the
                free options with no account at all. Providers whose subscriptions do not include API access say so
                plainly instead of offering a Connect button that cannot work.
              </p>
              {PROVIDER_ORDER.map((providerId) => (
                <ProviderCard key={providerId} providerId={providerId} />
              ))}
            </>
          )}

          {tab === 'chat' && (
            <div className="space-y-5">
              <Field
                label="System prompt"
                htmlFor="settings-system-prompt"
                hint="Prepended to every conversation. Leave empty for the provider's default behaviour."
              >
                <textarea
                  id="settings-system-prompt"
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  rows={4}
                  placeholder="You are a concise assistant. Prefer plain language."
                  className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-sm leading-relaxed text-fg placeholder:text-muted focus:border-accent focus:outline-none"
                />
              </Field>

              <Field
                label={`Temperature — ${temperature.toFixed(2)}`}
                htmlFor="settings-temperature"
                hint="Lower is more focused, higher is more creative. Some reasoning models ignore this."
              >
                <input
                  id="settings-temperature"
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={temperature}
                  onChange={(event) => setTemperature(Number(event.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-[var(--c-accent)]"
                />
              </Field>

              <label className="flex items-start justify-between gap-4 rounded-xl border border-line p-3.5">
                <span>
                  <span className="block text-[13px] font-medium text-fg">Auto-scroll while streaming</span>
                  <span className="mt-0.5 block max-w-[48ch] text-[12px] leading-relaxed text-muted">
                    Off means new tokens never move the page — you scroll when you are ready.
                  </span>
                </span>
                <Switch checked={autoScroll} onChange={setAutoScroll} label="Auto-scroll while streaming" />
              </label>

              <p className="rounded-xl border border-line bg-surface-2/40 px-3.5 py-3 text-[12px] leading-relaxed text-muted">
                Adding a model is a one-line change in <code className="font-mono">src/providers/models.ts</code>; adding a
                provider is a small adapter plus a row in{' '}
                <code className="font-mono">src/providers/providers.ts</code>. The README walks through both.
              </p>
            </div>
          )}

          {tab === 'appearance' && (
            <div className="space-y-4">
              <Field label="Theme" hint="System follows your operating system setting and keeps following it.">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { id: 'light', label: 'Light', icon: <SunIcon size={15} /> },
                      { id: 'dark', label: 'Dark', icon: <MoonIcon size={15} /> },
                      { id: 'system', label: 'System', icon: <SystemIcon size={15} /> },
                    ] as Array<{ id: ThemeMode; label: string; icon: React.ReactNode }>
                  ).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setTheme(option.id)}
                      aria-pressed={theme === option.id}
                      className={cn(
                        'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] transition-colors',
                        theme === option.id
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-line bg-surface text-muted hover:text-fg',
                      )}
                    >
                      {option.icon}
                      {option.label}
                    </button>
                  ))}
                </div>
              </Field>
              <p className="text-[12px] leading-relaxed text-muted">
                Motion follows your system's reduced-motion preference: the aura stops animating and transitions collapse
                to instant.
              </p>
            </div>
          )}

          {tab === 'data' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-line bg-surface-2/40 p-3.5">
                <h3 className="text-[13px] font-medium text-fg">Where your data lives</h3>
                <ul className="mt-2 space-y-1.5 text-[12px] leading-relaxed text-muted">
                  <li>
                    <span className="text-fg">API keys</span> —{storedKeyCount > 0 ? ` ${storedKeyCount} provider${storedKeyCount === 1 ? '' : 's'} configured.` : ' none saved.'}{' '}
                    Remembered keys sit in this browser's localStorage; unticked ones exist only in memory. They are sent
                    only to the provider that issued them, never to this app's origin.
                  </li>
                  <li>
                    <span className="text-fg">Conversations</span> —{` ${metas.length} chat${metas.length === 1 ? '' : 's'}, ${messageCount} messages `}
                    in {storageMode() === 'indexeddb' ? 'IndexedDB' : 'memory (IndexedDB is unavailable here)'} on this
                    device.
                  </li>
                  <li>
                    <span className="text-fg">Free tier</span> — if you use the shared free tier, your messages pass
                    through this app's proxy to the provider. It stores nothing and logs no prompt content.
                  </li>
                  <li>
                    <span className="text-fg">No analytics.</span> No telemetry, no error reporting, no third-party
                    scripts.
                  </li>
                </ul>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="danger" onClick={() => setConfirmClear(true)}>
                  Clear all data
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    resetEverything();
                    toastSuccess('Settings reset', 'Preferences are back to their defaults.');
                  }}
                >
                  Reset preferences
                </Button>
              </div>
            </div>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmClear}
        title="Clear all data?"
        body={
          <>
            Deletes every conversation from this device, removes all saved API keys and preferences, and frees the
            in-browser model cache. This cannot be undone.
          </>
        }
        confirmLabel="Delete everything"
        destructive
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          void clearEverything().then(() => {
            resetEverything();
            toastSuccess('All data cleared', 'Nothing is left on this device.');
          });
        }}
      />
    </>
  );
}
