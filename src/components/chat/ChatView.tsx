import { useChatStore } from '../../store/chatStore';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import type { ProviderId } from '../../providers/providers';
import type { ChatMessage } from '../../types';

interface ChatViewProps {
  onOpenModelPicker(): void;
  onRequestKey(providerId: ProviderId, modelId: string): void;
}

const EMPTY: ChatMessage[] = [];

export function ChatView({ onOpenModelPicker, onRequestKey }: ChatViewProps) {
  const activeId = useChatStore((state) => state.activeId);
  const messages = useChatStore((state) => (state.activeId ? (state.messages[state.activeId] ?? EMPTY) : EMPTY));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Keyed by conversation so scroll position and virtual measurements reset. */}
      <MessageList
        key={activeId ?? 'none'}
        conversationId={activeId}
        messages={messages}
        onRequestKey={onRequestKey}
      />
      <Composer onOpenModelPicker={onOpenModelPicker} onRequestKey={onRequestKey} />
    </div>
  );
}
