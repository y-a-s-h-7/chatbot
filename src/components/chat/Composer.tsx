import { useEffect, useRef, useState } from 'react';
import { cn, isMac } from '../../lib/utils';
import { useChatStore } from '../../store/chatStore';
import { useLiveStore } from '../../store/liveStore';
import { useModelStore } from '../../store/modelStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getAvailability } from '../../providers';
import type { ProviderId } from '../../providers/providers';
import { Aura } from './Aura';
import { Badge, IconButton } from '../ui/controls';
import { ChevronDownIcon, KeyIcon, SendIcon, StopIcon } from '../icons';

interface ComposerProps {
  onOpenModelPicker(): void;
  onRequestKey(providerId: ProviderId, modelId: string): void;
}

export function Composer({ onOpenModelPicker, onRequestKey }: ComposerProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const send = useChatStore((state) => state.send);
  const stop = useChatStore((state) => state.stop);
  const phase = useLiveStore((state) => state.phase);
  const modelId = useSettingsStore((state) => state.modelId);
  const entry = useModelStore((state) => state.byId(modelId));
  const streaming = phase !== 'idle';

  const availability = entry ? getAvailability(entry) : undefined;
  const blocked = availability ? availability.status === 'needs-key' || availability.status === 'connect' || availability.status === 'unavailable' : false;

  // Keep the height following the content, but never taller than a few lines.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  }, [value]);

  async function submit() {
    const text = value.trim();
    if (!text || streaming || blocked) return;
    setValue('');
    await send(text);
  }

  return (
    <div className="pb-safe relative px-3 pt-1 sm:px-4">
      <Aura />
      <div className="mx-auto w-full max-w-[46rem]">
        <div className="relative">
          <div
            className={cn(
              'relative rounded-2xl border border-line bg-surface/92 backdrop-blur',
              'shadow-[var(--shadow-soft)] transition-colors duration-150',
              'focus-within:border-line-strong',
            )}
          >
            <label htmlFor="composer" className="sr-only">
              Message
            </label>
            <textarea
              id="composer"
              ref={textareaRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submit();
                }
              }}
              rows={1}
              placeholder={blocked ? 'Add a key for this model to start chatting…' : 'Ask anything…'}
              className="max-h-52 w-full resize-none bg-transparent px-4 pb-11 pt-3.5 text-[15px] leading-relaxed text-fg placeholder:text-muted focus:outline-none"
              aria-describedby="composer-hint"
              disabled={blocked}
            />

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2">
              <div className="pointer-events-auto flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={onOpenModelPicker}
                  // Switching mid-stream would make the model footer a lie, so the
                  // picker only opens once the current reply has finished.
                  disabled={streaming}
                  title={streaming ? 'Stop the current reply to switch models' : undefined}
                  className="inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                  aria-haspopup="dialog"
                  aria-label={`Model: ${entry?.label ?? 'choose a model'}. Open the model picker.`}
                >
                  <span className="max-w-[9rem] truncate text-fg">{entry?.label ?? 'Choose a model'}</span>
                  {availability && (
                    <Badge tone={availability.status === 'ready' ? 'accent' : 'neutral'}>{availability.badge}</Badge>
                  )}
                  <ChevronDownIcon size={13} />
                </button>
              </div>

              <div className="pointer-events-auto flex items-center gap-1.5">
                {blocked && entry && (
                  <button
                    type="button"
                    onClick={() => onRequestKey(entry.provider as ProviderId, entry.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-[12px] font-medium text-accent transition-opacity hover:opacity-85"
                  >
                    <KeyIcon size={13} />
                    {availability?.status === 'connect' ? 'Connect' : 'Add key'}
                  </button>
                )}
                {streaming ? (
                  <button
                    type="button"
                    onClick={stop}
                    aria-label="Stop generating"
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-[13px] font-medium text-fg transition-colors hover:bg-surface-2"
                  >
                    <StopIcon size={14} />
                    Stop
                  </button>
                ) : (
                  <IconButton
                    label="Send message"
                    size={40}
                    onClick={() => void submit()}
                    disabled={!value.trim() || blocked}
                    className={cn(
                      'border border-transparent',
                      value.trim() && !blocked ? 'bg-accent text-accent-contrast hover:bg-accent' : 'text-muted',
                    )}
                  >
                    <SendIcon size={17} />
                  </IconButton>
                )}
              </div>
            </div>
          </div>
        </div>

        <p id="composer-hint" className="mt-2 px-1 text-center text-[11px] text-muted">
          Enter to send · Shift+Enter for a new line · {isMac() ? '⌘' : 'Ctrl'}K to switch models
        </p>
      </div>
    </div>
  );
}
