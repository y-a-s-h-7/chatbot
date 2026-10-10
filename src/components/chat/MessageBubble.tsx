import { lazy, memo, Suspense, useDeferredValue, useEffect, useRef, useState } from 'react';
import { copyText, cn } from '../../lib/utils';
import type { ChatMessage } from '../../types';
import { useChatStore } from '../../store/chatStore';
import { useLiveStore } from '../../store/liveStore';
import { Button } from '../ui/controls';
import { AlertIcon, CheckIcon, CopyIcon, EditIcon, RefreshIcon, SparkIcon, TrashIcon } from '../icons';
import { useThrottledValue } from '../../hooks/useThrottledValue';

/**
 * Markdown + remark are a large dependency, so they are split out and fetched
 * after the first paint. Until they arrive the raw text is shown, which reads
 * fine and means no layout jump. Syntax highlighting loads one layer deeper.
 */
const Markdown = lazy(() => import('../markdown/Markdown').then((mod) => ({ default: mod.Markdown })));

function RenderedText({ content, streaming = false }: { content: string; streaming?: boolean }) {
  return (
    <Suspense
      fallback={
        <div className={cn('whitespace-pre-wrap text-[15px] leading-relaxed', streaming && 'stream-caret')}>{content}</div>
      }
    >
      <Markdown content={content} />
    </Suspense>
  );
}

/** Shown under an assistant message: which model answered, and why it stopped. */
function MessageFooter({ message }: { message: ChatMessage }) {
  const parts: string[] = [];
  if (message.modelLabel) parts.push(message.modelLabel);
  if (message.usage?.outputTokens) parts.push(`${message.usage.outputTokens} tokens out`);
  if (message.note) parts.push(message.note);
  if (!parts.length) return null;
  return <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{parts.join(' · ')}</p>;
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] text-muted',
        'transition-colors duration-150 hover:bg-surface-2 hover:text-fg',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/**
 * The streaming bubble. It subscribes to the live store on its own, so token
 * flushes never re-render the rest of the conversation. Markdown parsing runs on
 * a deferred value so a fast model cannot stall the frame loop.
 */
function StreamingBody({ messageId }: { messageId: string }) {
  const text = useLiveStore((s) => s.text);
  const phase = useLiveStore((s) => s.phase);
  const statusText = useLiveStore((s) => s.statusText);
  const progress = useLiveStore((s) => s.progress);
  // Markdown is re-parsed at most ~11 times a second while text is arriving;
  // deferred rendering then keeps the frame loop free if a parse runs long.
  const throttled = useThrottledValue(text, 90);
  const deferred = useDeferredValue(throttled);

  return (
    <div aria-live="polite" aria-atomic="false">
      {phase === 'preparing' || (phase === 'thinking' && !deferred) ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            <span className="mr-2 inline-flex gap-1 align-middle">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:300ms]" />
            </span>
            {statusText ?? (phase === 'preparing' ? 'Getting the model ready…' : 'Thinking…')}
          </p>
          {typeof progress === 'number' && progress > 0 && progress < 1 && (
            <div className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className={cn(phase === 'streaming' && 'stream-caret')}>
            <RenderedText content={deferred} streaming />
          </div>
          {statusText && <p className="mt-2 text-[11px] text-muted">{statusText}</p>}
        </>
      )}
      {/* Keep the row height honest while the first tokens are still in flight. */}
      <span data-stream-target={messageId} />
    </div>
  );
}

/**
 * `streaming` is passed in rather than read from the live store, so a message
 * does not subscribe to stream state. Only the one bubble that is actually
 * receiving tokens re-renders when the stream begins or ends.
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  streaming = false,
}: {
  message: ChatMessage;
  streaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!editing) return;
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 320)}px`;
  }, [editing]);

  async function handleCopy() {
    if (await copyText(message.content)) setCopied(true);
  }

  if (message.role === 'user') {
    return (
      <article className="group/msg flex flex-col items-end gap-1" aria-label="Your message">
        {editing ? (
          <div className="w-full max-w-[85%] rounded-2xl border border-line bg-surface p-2">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                event.currentTarget.style.height = 'auto';
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 320)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void useChatStore.getState().editAndResend(message.id, draft);
                  setEditing(false);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDraft(message.content);
                  setEditing(false);
                }
              }}
              rows={2}
              className="max-h-80 w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-fg focus:outline-none"
              aria-label="Edit your message"
            />
            <div className="flex items-center justify-between gap-2 px-1 pt-1">
              <span className="text-[11px] text-muted">⌘/Ctrl + Enter to resend · Esc to cancel</span>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(message.content);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!draft.trim()}
                  onClick={() => {
                    void useChatStore.getState().editAndResend(message.id, draft);
                    setEditing(false);
                  }}
                >
                  Resend
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-line bg-surface-2 px-3.5 py-2.5 text-[15px] leading-relaxed text-fg">
              {message.content}
            </div>
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/msg:opacity-100 sm:gap-1">
              <ActionButton
                label={copied ? 'Copied' : 'Copy'}
                icon={copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                onClick={handleCopy}
              />
              <ActionButton
                label="Edit"
                icon={<EditIcon size={13} />}
                onClick={() => {
                  setDraft(message.content);
                  setEditing(true);
                }}
              />
              <ActionButton
                label="Delete"
                icon={<TrashIcon size={13} />}
                onClick={() => useChatStore.getState().deleteMessage(message.id)}
              />
            </div>
          </>
        )}
      </article>
    );
  }

  return (
    <article className="group/msg flex flex-col gap-1" aria-label="Assistant message">
      {message.status === 'error' && (
        <div className="flex items-start gap-2.5 rounded-xl border border-line bg-danger-soft/60 px-3 py-2.5">
          <span className="mt-0.5 text-danger">
            <AlertIcon size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">{message.error?.title ?? 'Something went wrong'}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
              <span dangerouslySetInnerHTML={{ __html: renderInline(message.error?.message ?? '') }} />
            </p>
            {message.error?.action?.href && (
              <a
                href={message.error.action.href}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-1.5 inline-block text-[13px] font-medium text-accent underline underline-offset-2"
              >
                {message.error.action.label}
              </a>
            )}
            {message.content.trim() && (
              <p className="mt-2 border-t border-line pt-2 text-[13px] text-muted">
                Partial reply kept below.
              </p>
            )}
          </div>
          {message.error?.retryable && (
            <Button
              size="sm"
              variant="secondary"
              icon={<RefreshIcon size={13} />}
              onClick={() => void useChatStore.getState().regenerate(message.id)}
            >
              Retry
            </Button>
          )}
        </div>
      )}

      {message.status === 'pending' && !streaming && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <SparkIcon size={14} /> Working…
        </p>
      )}

      {streaming ? (
        <StreamingBody messageId={message.id} />
      ) : (
        message.content.trim() && <RenderedText content={message.content} />
      )}

      {message.status === 'stopped' && (
        <p className="mt-1 text-[11px] uppercase tracking-wide text-muted">Stopped</p>
      )}

      {!(message.status === 'pending' && !streaming) && <MessageFooter message={message} />}

      {!streaming && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/msg:opacity-100 sm:gap-1">
          <ActionButton
            label={copied ? 'Copied' : 'Copy'}
            icon={copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
            onClick={handleCopy}
            disabled={!message.content}
          />
          <ActionButton
            label="Regenerate"
            icon={<RefreshIcon size={13} />}
            onClick={() => void useChatStore.getState().regenerate(message.id)}
          />
          <ActionButton
            label="Delete"
            icon={<TrashIcon size={13} />}
            onClick={() => useChatStore.getState().deleteMessage(message.id)}
          />
        </div>
      )}
    </article>
  );
});

/**
 * Provider error messages use **bold** for the provider name. We render that one
 * little bit of inline emphasis rather than pulling markdown into an error row.
 */
function renderInline(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(/\*\*(.+?)\*\*/g, '<strong class="font-medium text-fg">$1</strong>');
}
