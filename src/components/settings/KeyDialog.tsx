import { useEffect, useRef, useState } from 'react';
import { maskKey } from '../../lib/credentials';
import { startOpenRouterConnect } from '../../lib/oauth';
import { PROVIDERS, getProvider } from '../../providers';
import { toProviderError } from '../../providers/errors';
import { isNativeShell } from '../../lib/native/platform';
import type { ProviderId } from '../../providers/providers';
import { useModelStore } from '../../store/modelStore';
import { keyStorageLabel, useSettingsStore } from '../../store/settingsStore';
import { toastSuccess } from '../../store/toastStore';
import { Button, Field, Switch, TextInput } from '../ui/controls';
import { Dialog } from '../ui/Dialog';
import { AlertIcon, CheckIcon, PlugIcon } from '../icons';

interface KeyDialogProps {
  open: boolean;
  providerId: ProviderId | null;
  modelId: string | null;
  onClose(): void;
}

/**
 * Opened whenever the user picks a model that needs credentials, so the flow
 * never dead-ends in a failed request.
 */
export function KeyDialog({ open, providerId, modelId, onClose }: KeyDialogProps) {
  const storedKey = useSettingsStore((state) => (providerId ? state.keys[providerId] : undefined));
  const rememberPref = useSettingsStore((state) => (providerId ? Boolean(state.remember[providerId]) : false));
  const nativeRemember = isNativeShell();
  const setKey = useSettingsStore((state) => state.setKey);
  const setStoreRemember = useSettingsStore((state) => state.setRemember);
  const clearKey = useSettingsStore((state) => state.clearKey);
  const setBaseUrl = useSettingsStore((state) => state.setBaseUrl);
  const customBaseUrl = useSettingsStore((state) => state.customBaseUrl);
  const ollamaBaseUrl = useSettingsStore((state) => state.ollamaBaseUrl);
  const refreshFreeProxy = useModelStore((state) => state.refreshFreeProxy);
  const discover = useModelStore((state) => state.discover);

  const [draft, setDraft] = useState('');
  const [remember, setRemember] = useState(false);
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [baseUrlDraft, setBaseUrlDraft] = useState('');
  const previousKey = useRef<string | undefined>(undefined);
  const verified = useRef(false);

  const entry = providerId ? PROVIDERS[providerId] : null;

  useEffect(() => {
    if (!open || !providerId) return;
    const key = useSettingsStore.getState().keys[providerId] ?? '';
    setDraft(key);
    setRemember(Boolean(useSettingsStore.getState().remember[providerId]));
    setStatus('idle');
    setMessage(null);
    setBaseUrlDraft(providerId === 'custom' ? customBaseUrl : providerId === 'ollama' ? ollamaBaseUrl : '');
    previousKey.current = key || undefined;
    verified.current = false;
  }, [open, providerId, customBaseUrl, ollamaBaseUrl]);

  if (!entry || !providerId) return null;

  async function runTest(target: ProviderId, label: string): Promise<boolean> {
    setStatus('testing');
    setMessage(null);
    setKey(target, draft, remember);
    try {
      const result = await getProvider(target).test();
      setStatus('ok');
      setMessage(result.detail);
      verified.current = true;
      // Load this provider's models immediately, so the model the user was
      // reaching for is usable the moment this dialog closes.
      await discover(target, { force: true });
      if (target === 'free-proxy') await refreshFreeProxy(true);
      return true;
    } catch (error) {
      const friendly = toProviderError(error, label);
      setStatus('error');
      setMessage(friendly.message.replace(/\*\*/g, ''));
      return false;
    }
  }

  function handleClose(save: boolean) {
    if (!providerId) return;
    if (!save && !verified.current) {
      // Nothing was verified: put the credential back the way we found it.
      if (previousKey.current) setKey(providerId, previousKey.current, rememberPref);
      else clearKey(providerId);
    }
    onClose();
  }

  const needsBaseUrl = entry.userBaseUrl && !baseUrlDraft.trim();

  return (
    <Dialog
      open={open}
      onClose={() => handleClose(false)}
      title={`${entry.name} needs credentials`}
      description={entry.blurb}
      size="md"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted">
            {remember
              ? 'Stored in this browser (localStorage). Cancel discards what you pasted.'
              : 'Kept in memory only — gone when this tab closes. Cancel discards what you pasted.'}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => handleClose(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={(!draft.trim() && !entry.keyless) || needsBaseUrl}
              onClick={async () => {
                const ok = await runTest(providerId, entry.name);
                if (ok) {
                  toastSuccess(`${entry.name} is ready`, 'You can send a message now.');
                  onClose();
                }
              }}
            >
              {draft.trim() || entry.keyless ? 'Test and save' : 'Save'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5 px-5 py-4">
        {entry.connect.supported ? (
          <div className="rounded-xl border border-line bg-surface-2/50 p-3.5">
            <p className="text-sm font-medium text-fg">Connect your {entry.name} account</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              One click creates a key you own and can revoke from your OpenRouter dashboard. Nothing passes through this
              app.
            </p>
            <Button
              variant="primary"
              size="sm"
              className="mt-2.5"
              icon={<PlugIcon size={14} />}
              onClick={() => {
                void startOpenRouterConnect();
              }}
            >
              Connect {entry.name}
            </Button>
            <p className="mt-2.5 text-[11px] text-muted">…or paste a key below instead.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-surface-2/50 p-3.5">
            <p className="flex items-center gap-2 text-sm font-medium text-fg">
              <AlertIcon size={15} /> Use an API key instead
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{entry.connect.reason}</p>
          </div>
        )}

        {(entry.userBaseUrl || providerId === 'ollama') && (
          <Field
            label="Base URL"
            htmlFor="key-dialog-base-url"
            hint={
              providerId === 'ollama'
                ? 'Default is http://localhost:11434/v1. Start Ollama with OLLAMA_ORIGINS set to this page’s origin.'
                : 'Any endpoint that implements POST /chat/completions and GET /models.'
            }
          >
            <TextInput
              id="key-dialog-base-url"
              value={baseUrlDraft}
              onChange={(event) => {
                setBaseUrlDraft(event.target.value);
                setBaseUrl(providerId, event.target.value);
              }}
              placeholder={providerId === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.example.com/v1'}
              spellCheck={false}
              autoCapitalize="off"
            />
          </Field>
        )}

        {!entry.keyless && (
          <Field
            label="API key"
            htmlFor="key-dialog-key"
            hint={
              entry.keyUrl ? (
                <>
                  Create one at{' '}
                  <a
                    href={entry.keyUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent underline underline-offset-2"
                  >
                    {new URL(entry.keyUrl).hostname}
                  </a>
                  . It is sent only to {entry.name}.
                </>
              ) : (
                'Sent only to this provider.'
              )
            }
          >
            <div className="flex gap-2">
              <TextInput
                id="key-dialog-key"
                type="password"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setStatus('idle');
                }}
                placeholder={entry.apiKeyPlaceholder ?? 'paste your key'}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
              />
              <Button
                variant="secondary"
                onClick={() => void runTest(providerId, entry.name)}
                disabled={!draft.trim() || status === 'testing'}
              >
                {status === 'testing' ? 'Testing…' : 'Test key'}
              </Button>
            </div>
          </Field>
        )}

        <div className="flex items-start justify-between gap-4 rounded-xl border border-line p-3.5">
          <div>
            <p className="text-[13px] font-medium text-fg">Remember on this device</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
              {remember
                ? nativeRemember
                  ? `The key is handed to ${keyStorageLabel()}, so it survives a restart and other apps cannot read it.`
                  : 'The key is saved in this browser’s localStorage so it survives a reload. Anyone with access to this browser profile can read it.'
                : 'The key stays in memory for this session only. Nothing is written to disk.'}
            </p>
          </div>
          <Switch
            checked={remember}
            onChange={(value) => {
              setRemember(value);
              if (!providerId) return;
              // Applies to any key already saved for this provider, so turning
              // this off immediately removes it from disk. Anything else would
              // let the note below contradict what is actually stored.
              const alreadySaved = Boolean(useSettingsStore.getState().keys[providerId]);
              if (alreadySaved) setStoreRemember(providerId, value);
            }}
            label="Remember on this device"
          />
        </div>

        {status !== 'idle' && message && (
          <p
            role="status"
            className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed ${
              status === 'ok' ? 'border-line text-fg' : status === 'error' ? 'border-line text-danger' : 'border-line text-muted'
            }`}
          >
            {status === 'ok' ? <CheckIcon size={15} /> : status === 'error' ? <AlertIcon size={15} /> : null}
            {message}
          </p>
        )}

        {storedKey && status === 'idle' && (
          <p className="text-[11px] text-muted">
            Currently saved for this provider: <span className="font-mono">{maskKey(storedKey)}</span>
            {modelId ? ` · waiting on ${modelId.split(':').pop()}` : ''}
          </p>
        )}
      </div>
    </Dialog>
  );
}
