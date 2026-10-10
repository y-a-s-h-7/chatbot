import { useCallback, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { createCoalescer } from '../../lib/streamBuffer';
import { useChatStore } from '../../store/chatStore';
import { useLiveStore } from '../../store/liveStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useModelStore } from '../../store/modelStore';
import { getAvailability, hasWebGpu } from '../../providers';
import type { ProviderId } from '../../providers/providers';
import type { ChatMessage } from '../../types';
import { cn } from '../../lib/utils';
import { ArrowDownIcon } from '../icons';
import { EmptyState } from './EmptyState';
import { MessageBubble } from './MessageBubble';
import { useGreeting } from '../../hooks/useGreeting';

/** Beyond this many messages, rendering everything becomes the bottleneck. */
const VIRTUAL_THRESHOLD = 40;
const PIN_THRESHOLD_PX = 96;

interface MessageListProps {
  conversationId: string | null;
  messages: ChatMessage[];
  onRequestKey(providerId: ProviderId, modelId: string): void;
}

export function MessageList({ conversationId, messages, onRequestKey }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const autoScroll = useSettingsStore((state) => state.autoScroll);
  const send = useChatStore((state) => state.send);
  const greeting = useGreeting();

  // One subscription for the whole list instead of one per message: only this
  // component reacts when a stream starts or stops, and only the matching bubble
  // receives new props (memo keeps every other bubble untouched).
  const streamingId = useLiveStore((state) => (state.conversationId === conversationId ? state.messageId : null));
  const streaming = streamingId !== null;

  const currentModelId = useSettingsStore((state) => state.modelId);
  const setModel = useSettingsStore((state) => state.setModel);
  const entry = useModelStore((state) => state.byId(currentModelId));
  const browserModel = useModelStore((state) => state.models.find((model) => model.provider === 'browser' && model.recommended));

  const availability = entry ? getAvailability(entry) : undefined;
  const ready = availability?.status === 'ready';

  const virtual = messages.length >= VIRTUAL_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 132,
    overscan: 6,
    enabled: virtual,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  // Follow new tokens, but only while the user is parked at the bottom. Writes
  // are coalesced to one per frame so a fast model cannot thrash the scroller.
  useEffect(() => {
    if (!autoScroll) return;
    const coalescer = createCoalescer(() => {
      if (pinnedRef.current) scrollToBottom();
    });
    const unsubscribe = useLiveStore.subscribe(() => coalescer.schedule());
    return () => {
      unsubscribe();
      coalescer.cancel();
    };
  }, [autoScroll, scrollToBottom]);

  // A new message (or a new conversation) always pulls the view down. The
  // timeout runs the scroll after the browser has had a chance to lay out.
  useEffect(() => {
    pinnedRef.current = true;
    setPinned(true);
    const timer = setTimeout(() => scrollToBottom(), 30);
    return () => clearTimeout(timer);
  }, [messages.length, scrollToBottom]);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const next = distance < PIN_THRESHOLD_PX;
    if (next !== pinnedRef.current) {
      pinnedRef.current = next;
      setPinned(next);
    }
  }, []);

  /** A suggestion chip must not create a turn that can only fail. */
  const handlePick = useCallback(
    (prompt: string) => {
      if (ready || !entry) {
        void send(prompt);
        return;
      }
      onRequestKey(entry.provider, entry.id);
    },
    [entry, onRequestKey, ready, send],
  );

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain scrollbar-thin [overflow-anchor:none]"
        role="log"
        aria-label="Conversation"
        aria-live="off"
        aria-busy={streaming}
        tabIndex={-1}
      >
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-[46rem] flex-col justify-center px-4">
            <EmptyState
              greeting={greeting}
              modelName={entry?.label ?? 'a model'}
              ready={ready}
              unavailableReason={ready ? undefined : availability?.detail}
              browserModel={browserModel ? { id: browserModel.id, label: browserModel.label } : undefined}
              webGpuAvailable={hasWebGpu()}
              onPick={handlePick}
              onUseBrowserModel={browserModel ? () => setModel(browserModel.id) : undefined}
              onAddKey={entry ? () => onRequestKey(entry.provider, entry.id) : undefined}
            />
          </div>
        ) : virtual ? (
          <div className="mx-auto w-full max-w-[46rem] px-4 pb-10 pt-6" style={{ height: virtualizer.getTotalSize() }}>
            <div className="relative w-full">
              {virtualizer.getVirtualItems().map((item) => (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <div className="pb-6">
                    <MessageBubble message={messages[item.index]} streaming={messages[item.index].id === streamingId} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-6 px-4 pb-10 pt-6">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} streaming={message.id === streamingId} />
            ))}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <button
          type="button"
          onClick={() => {
            pinnedRef.current = true;
            setPinned(true);
            scrollToBottom('smooth');
          }}
          className={cn(
            'pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/95 px-3 py-1.5 text-xs font-medium text-fg shadow-[var(--shadow-soft)] backdrop-blur',
            'transition-[opacity,transform] duration-200',
            pinned ? 'pointer-events-none translate-y-2 opacity-0' : 'opacity-100',
          )}
          aria-hidden={pinned}
          tabIndex={pinned ? -1 : 0}
        >
          <ArrowDownIcon size={14} />
          Jump to latest
        </button>
      </div>
    </div>
  );
}
