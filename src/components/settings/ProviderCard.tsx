import { useEffect, useState } from 'react';
import { maskKey } from '../../lib/credentials';
import { startOpenRouterConnect } from '../../lib/oauth';
import { MODELS } from '../../providers/models';
import { PROVIDERS, getProvider, probeFreeProxy } from '../../providers';
import type { ProviderId } from '../../providers/providers';
import { toProviderError } from '../../providers/errors';
import { isNativeShell } from '../../lib/native/platform';
import { useModelStore } from '../../store/modelStore';
import { keyStorageLabel, useSettingsStore } from '../../store/settingsStore';
import { Badge, Button, Switch, TextInput } from '../ui/controls';
import { AlertIcon, CheckIcon, PlugIcon } from '../icons';

type TestState = { kind: 'idle' | 'testing' | 'ok' | 'error'; message?: string };

export function ProviderCard({ providerId }: { providerId: ProviderId }) {
  const entry = PROVIDERS[providerId];
  const key = useSettingsStore((state) => state.keys[providerId] ?? '');
  const remember = useSettingsStore((state) => Boolean(state.remember[providerId]));
  const shellRememberHint = isNativeShell();
  const connected = useSettingsStore((state) => Boolean(state.connected[providerId]));
  const customBaseUrl = useSettingsStore((state) => state.customBaseUrl);
  const ollamaBaseUrl = useSettingsStore((state) => state.ollamaBaseUrl);
  const setKey = useSettingsStore((state) => state.setKey);
  const clearKey = useSettingsStore((state) => state.clearKey);
  const setBaseUrl = useSettingsStore((state) => state.setBaseUrl);
  const setConnected = useSettingsStore((state) => state.setConnected);
  const discover = useModelStore((state) => state.discover);
  const freeProxy = useModelStore((state) => state.freeProxy);
  const refreshFreeProxy = useModelStore((state) => state.refreshFreeProxy);

  const [draft, setDraft] = useState(key);
  const [baseDraft, setBaseDraft] = useState(
    providerId === 'custom' ? customBaseUrl : providerId === 'ollama' ? ollamaBaseUrl : '',
  );
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  useEffect(() => setDraft(key), [key]);

  const modelCount = MODELS.filter((model) => model.provider === providerId && !model.retired).length;
  const isOauthProvider = entry.connect.supported;
  const hasCredential = Boolean(key) || connected;
  const showKeyField = !entry.keyless || isOauthProvider;

  async function runTest() {
    setTest({ kind: 'testing' });
    setKey(providerId, draft, remember);
    try {
      const result = await getProvider(providerId).test();
      setTest({ kind: 'ok', message: result.detail });
      // A key that just started working must show its models straight away.
      await discover(providerId, { force: true });
      if (providerId === 'free-proxy') await refreshFreeProxy(true);
    } catch (error) {
      setTest({ kind: 'error', message: toProviderError(error, entry.name).message.replace(/\*\*/g, '') });
    }
  }

  useEffect(() => {
    if (!connected) return;
    void discover(providerId, { force: true });
  }, [connected, discover, providerId]);

  return (
    <section className="rounded-2xl border border-line bg-surface/60 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-medium text-fg">
            {entry.name}
            {hasCredential && (
              <Badge tone="success">
                <CheckIcon size={11} /> {connected ? 'Connected' : 'Key saved'}
              </Badge>
            )}
            {entry.keyless && <Badge tone="accent">No key needed</Badge>}
          </h3>
          <p className="mt-1 max-w-[46ch] text-[13px] leading-relaxed text-muted">{entry.blurb}</p>
          {entry.note && <p className="mt-1 max-w-[46ch] text-[12px] leading-relaxed text-muted">{entry.note}</p>}
          <p className="mt-1.5 text-[11px] text-muted">
            {modelCount > 0 ? `${modelCount} curated models` : 'Models load live once connected'}
            {entry.keyUrl && (
              <>
                {' · '}
                <a
                  href={entry.keyUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent underline underline-offset-2"
                >
                  Get a key
                </a>
              </>
            )}
            {' · '}
            <a href={entry.docsUrl} target="_blank" rel="noreferrer noopener" className="text-accent underline underline-offset-2">
              Docs
            </a>
          </p>
        </div>

        {isOauthProvider && (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {connected ? (
              <>
                <Badge tone="accent">
                  <PlugIcon size={11} /> Connected
                </Badge>
                <button
                  type="button"
                  onClick={() => setConnected(providerId, false)}
                  className="text-[11px] text-muted underline underline-offset-2 hover:text-fg"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon={<PlugIcon size={14} />}
                onClick={() => {
                  void startOpenRouterConnect();
                }}
              >
                Connect
              </Button>
            )}
          </div>
        )}
      </header>

      {providerId === 'free-proxy' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/40 px-3 py-2.5">
          <Badge tone={freeProxy.configured ? 'success' : 'muted'}>{freeProxy.configured ? 'Available' : 'Not deployed'}</Badge>
          <p className="text-[12px] text-muted">
            {freeProxy.configured
              ? `Serving ${freeProxy.model}. Rate limited per minute for everyone using this deployment.`
              : (freeProxy.reason ?? 'This deployment has no free tier configured.')}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void probeFreeProxy(true).then(() => refreshFreeProxy(true));
            }}
          >
            Re-check
          </Button>
        </div>
      )}

      {(entry.userBaseUrl || providerId === 'ollama') && (
        <div className="mt-3 space-y-2">
          <TextInput
            value={baseDraft}
            onChange={(event) => {
              setBaseDraft(event.target.value);
              setBaseUrl(providerId, event.target.value);
            }}
            onBlur={() => {
              // Pointing at a new endpoint should refresh its model list at once.
              if (entry.userBaseUrl || providerId === 'ollama') void discover(providerId, { force: true });
            }}
            placeholder={providerId === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.example.com/v1'}
            aria-label={`${entry.name} base URL`}
            spellCheck={false}
            autoCapitalize="off"
          />
          <p className="text-[11px] text-muted">
            Adding an origin outside the built-in list also means adding it to <code>connect-src</code> in
            vite.config.ts.
          </p>
        </div>
      )}

      {showKeyField && (
        <div className="mt-3 space-y-2.5">
          <div className="flex flex-wrap gap-2">
            <TextInput
              type="password"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setTest({ kind: 'idle' });
              }}
              placeholder={entry.apiKeyPlaceholder ?? 'paste your API key'}
              aria-label={`${entry.name} API key`}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              className="max-w-md flex-1"
            />
            <Button onClick={() => void runTest()} disabled={(!draft.trim() && !connected) || test.kind === 'testing'}>
              {test.kind === 'testing' ? 'Testing…' : 'Test key'}
            </Button>
            {hasCredential && (
              <Button
                variant="ghost"
                onClick={() => {
                  clearKey(providerId);
                  setDraft('');
                  setTest({ kind: 'idle' });
                }}
              >
                Remove
              </Button>
            )}
          </div>

          <label className="flex items-start gap-3 text-[12px] text-muted">
            <Switch
              checked={remember}
              onChange={(value) => {
                setKey(providerId, draft, value);
              }}
              label={`Remember ${entry.name} key on this device`}
            />
            <span className="max-w-[52ch] leading-relaxed">
              Remember on this device
              <span className="block text-muted">
                {shellRememberHint
                  ? `Off means the key lives in memory only. On hands it to ${keyStorageLabel()}, where other websites and apps cannot read it.`
                  : 'Off means the key lives in memory only. On stores it in localStorage, readable by anything running on this origin.'}
              </span>
            </span>
          </label>

          {key && test.kind === 'idle' && (
            <p className="text-[11px] text-muted">
              Saved: <span className="font-mono">{maskKey(key)}</span>
            </p>
          )}
        </div>
      )}

      {test.kind !== 'idle' && test.message && (
        <p
          role="status"
          className={`mt-2.5 flex items-start gap-2 rounded-xl border border-line px-3 py-2 text-[12px] leading-relaxed ${
            test.kind === 'ok' ? 'text-fg' : test.kind === 'error' ? 'text-danger' : 'text-muted'
          }`}
        >
          {test.kind === 'ok' ? <CheckIcon size={14} /> : <AlertIcon size={14} />}
          {test.message}
        </p>
      )}
    </section>
  );
}
