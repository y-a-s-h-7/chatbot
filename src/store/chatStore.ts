import { create } from 'zustand';
import { createFrameBatcher } from '../lib/streamBuffer';
import {
  CHAT_SCHEMA_VERSION,
  deleteConversationRecord,
  loadConversation,
  loadIndex,
  saveConversation,
  saveIndex,
  clearChatStorage,
  type ConversationMeta,
} from '../lib/storage';
import { titleFromContent, uid } from '../lib/utils';
import { getAvailability, getProvider, modelKey } from '../providers';
import { ProviderError, toProviderError } from '../providers/errors';
import type { ModelEntry } from '../providers/models';
import type { ProviderMessage } from '../providers/types';
import { purgeBrowserModelCache, unloadBrowserModel } from '../providers/webllm';
import type { ChatMessage, MessageError } from '../types';
import { useLiveStore } from './liveStore';
import { BROWSER_FALLBACK_MODEL, DEFAULT_MODEL_ID, useSettingsStore } from './settingsStore';
import { useModelStore } from './modelStore';
import { useMemoryStore, type RememberOutcome } from './memoryStore';
import { toastError, toastSuccess } from './toastStore';

let activeController: AbortController | null = null;

interface ChatState {
  hydrated: boolean;
  metas: ConversationMeta[];
  messages: Record<string, ChatMessage[]>;
  activeId: string | null;

  hydrate(): Promise<void>;
  createConversation(): string;
  selectConversation(id: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  renameConversation(id: string, title: string): void;
  clearEverything(): Promise<void>;

  send(text: string): Promise<void>;
  stop(): void;
  regenerate(assistantMessageId: string): Promise<void>;
  editAndResend(userMessageId: string, content: string): Promise<void>;
  deleteMessage(messageId: string): void;
}

const EMPTY_MESSAGES: ChatMessage[] = [];

function newMeta(modelId: string): ConversationMeta {
  const now = Date.now();
  return { id: uid('c'), title: 'New chat', createdAt: now, updatedAt: now, modelId, messageCount: 0 };
}

/**
 * Anything that can go wrong becomes a short, human sentence plus the right
 * affordance. Raw provider JSON never reaches the UI.
 */
function describeError(err: ProviderError): MessageError {
  const titles: Record<ProviderError['code'], string> = {
    auth: 'Key rejected',
    forbidden: 'Access denied',
    rate_limit: 'Rate limited',
    quota: 'Out of credit',
    network: 'Network problem',
    server: 'Provider trouble',
    bad_request: 'Request rejected',
    not_found: 'Model unavailable',
    context_length: 'Conversation too long',
    aborted: 'Stopped',
    not_configured: 'Needs an API key',
    unsupported: 'Cannot run that model',
    webgpu_unavailable: 'WebGPU unavailable',
    unknown: 'Something went wrong',
  };
  return {
    title: titles[err.code] ?? 'Something went wrong',
    message: err.message,
    retryable: err.retryable,
    action: err.action,
  };
}

function providerLabelFor(entry: ModelEntry): string {
  return entry.label;
}

/**
 * Sending to a model with no usable credential or runtime would create a turn
 * that can only fail. Refuse it with a reason instead.
 */
function assertSendable(entry: ModelEntry): boolean {
  const availability = getAvailability(entry);
  if (availability.status === 'ready') return true;
  if (availability.status === 'needs-key' || availability.status === 'connect') {
    toastError('Add a key first', `${entry.label} needs credentials before it can answer.`);
    return false;
  }
  toastError('That model cannot run right now', availability.detail ?? availability.badge);
  return false;
}

/** The saved model, or the best thing we can honestly offer right now. */
function resolveEntry(modelId: string): ModelEntry {
  const store = useModelStore.getState();
  return (
    store.byId(modelId) ??
    store.bestDefaultModel() ??
    store.byId(BROWSER_FALLBACK_MODEL) ?? {
      id: modelId || DEFAULT_MODEL_ID,
      provider: 'browser',
      label: modelId || BROWSER_FALLBACK_MODEL,
      accessMode: 'free-default',
      contextWindow: 4096,
    }
  );
}

/**
 * What actually goes into the system prompt: the user's own instructions, plus
 * the memory ground rules and any saved facts. The rules are sent even when
 * memory is switched off — otherwise a model promises to remember things the app
 * has stored nowhere, which is the exact lie the memory feature exists to stop.
 */
function buildSystemPrompt(userPrompt: string): string {
  const memory = useMemoryStore.getState().section();
  return [userPrompt.trim(), memory].filter(Boolean).join('\n\n');
}

/** The one thing the user needs to know about an explicit "remember that …". */
function reportMemory(outcome: RememberOutcome): void {
  if (outcome.kind === 'saved') toastSuccess('Saved to memory', outcome.fact.text);
  else if (outcome.kind === 'secret')
    toastError('Not saved', 'That looks like a password or a key. Memory only keeps facts and preferences.');
  else if (outcome.kind === 'disabled')
    toastError('Memory is off', 'Turn on “Use memory” in Settings → Memory to save that.');
}

/** Conversation turns handed to a provider: no errors, no empty placeholders. */
function toProviderMessages(messages: ChatMessage[], assistantId: string): ProviderMessage[] {
  return messages
    .filter((m) => m.id !== assistantId)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => m.status !== 'error')
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
}

export const useChatStore = create<ChatState>((set, get) => {
  // -------------------------------------------------------------------------
  // Persistence helpers (write-through, debounced while streaming)
  // -------------------------------------------------------------------------
  let indexTimer: ReturnType<typeof setTimeout> | null = null;
  let conversationTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleIndexWrite() {
    if (indexTimer) clearTimeout(indexTimer);
    indexTimer = setTimeout(() => {
      indexTimer = null;
      const state = get();
      void saveIndex({
        version: CHAT_SCHEMA_VERSION,
        conversations: state.metas,
        activeId: state.activeId,
        updatedAt: Date.now(),
      });
    }, 250);
  }

  function scheduleConversationWrite(conversationId: string) {
    if (conversationTimer) clearTimeout(conversationTimer);
    conversationTimer = setTimeout(() => {
      conversationTimer = null;
      const state = get();
      const meta = state.metas.find((m) => m.id === conversationId);
      const messages = state.messages[conversationId];
      if (!meta || !messages) return;
      void saveConversation({ version: CHAT_SCHEMA_VERSION, meta, messages });
    }, 250);
  }

  function writeConversationNow(conversationId: string) {
    const state = get();
    const meta = state.metas.find((m) => m.id === conversationId);
    const messages = state.messages[conversationId];
    if (!meta || !messages) return;
    void saveConversation({ version: CHAT_SCHEMA_VERSION, meta, messages });
  }

  function touchConversation(conversationId: string, messages: ChatMessage[]) {
    const now = Date.now();
    set({
      messages: { ...get().messages, [conversationId]: messages },
      metas: get().metas.map((meta) =>
        meta.id === conversationId ? { ...meta, updatedAt: now, messageCount: messages.length } : meta,
      ),
    });
    scheduleIndexWrite();
  }

  function ensureActive(): string {
    const existing = get().activeId;
    if (existing && get().metas.some((m) => m.id === existing)) return existing;
    return get().createConversation();
  }

  // -------------------------------------------------------------------------
  // The streaming pipeline
  // -------------------------------------------------------------------------
  async function runAssistant(conversationId: string, assistantId: string, entry: ModelEntry): Promise<void> {
    const settings = useSettingsStore.getState();
    const messages = get().messages[conversationId] ?? EMPTY_MESSAGES;
    const history = toProviderMessages(messages, assistantId);

    const live = useLiveStore.getState();
    live.begin({
      messageId: assistantId,
      conversationId,
      modelLabel: entry.label,
      phase: entry.provider === 'browser' ? 'preparing' : 'thinking',
    });

    const controller = new AbortController();
    activeController = controller;

    const batcher = createFrameBatcher((text) => useLiveStore.getState().setText(text));
    let accumulated = '';
    let usage: ChatMessage['usage'];
    let note: string | undefined;

    try {
      const provider = getProvider(entry.provider);
      const stream = provider.stream(
        history,
        {
          model: entry.id,
          temperature: settings.temperature,
          system: buildSystemPrompt(settings.systemPrompt),
          maxOutputTokens: entry.maxOutput ? Math.min(entry.maxOutput, 4096) : undefined,
        },
        controller.signal,
      );

      for await (const event of stream) {
        switch (event.type) {
          case 'delta':
            accumulated += event.text;
            batcher.push(accumulated);
            if (useLiveStore.getState().phase !== 'streaming') useLiveStore.getState().setPhase('streaming');
            break;
          case 'status':
            note = event.text;
            useLiveStore.getState().setStatus(event.text, event.progress ?? null);
            break;
          case 'usage':
            usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
            break;
          case 'done':
            break;
        }
      }

      batcher.flushNow(accumulated);
      const finalText = accumulated;
      if (!finalText.trim()) {
        note = note ?? 'The model finished without sending any text.';
      }
      updateMessage(conversationId, assistantId, {
        content: finalText,
        status: 'done',
        usage,
        note,
      });
      writeConversationNow(conversationId);
    } catch (error) {
      batcher.cancel();
      const failure = toProviderError(error, providerLabelFor(entry));
      // Stop is a normal outcome, not an error: it must not raise a toast.
      const aborted = failure.code === 'aborted';
      const friendly = describeError(failure);

      if (aborted) {
        updateMessage(conversationId, assistantId, {
          content: accumulated,
          status: 'stopped',
          note: accumulated.trim() ? 'Stopped.' : 'Stopped before any text arrived.',
        });
      } else {
        updateMessage(conversationId, assistantId, {
          content: accumulated,
          status: 'error',
          error: friendly,
          usage,
        });
        toastError(friendly.title, friendly.message, {
          label: 'Retry',
          run: () => {
            void get().regenerate(assistantId);
          },
        });
      }
      writeConversationNow(conversationId);
    } finally {
      batcher.cancel();
      if (activeController === controller) activeController = null;
      useLiveStore.getState().end();
    }
  }

  function updateMessage(conversationId: string, messageId: string, patch: Partial<ChatMessage>) {
    const current = get().messages[conversationId] ?? EMPTY_MESSAGES;
    touchConversation(
      conversationId,
      current.map((message) => (message.id === messageId ? { ...message, ...patch } : message)),
    );
  }

  return {
    hydrated: false,
    metas: [],
    messages: {},
    activeId: null,

    async hydrate() {
      if (get().hydrated) return;
      const index = await loadIndex();
      if (!index) {
        const meta = newMeta(useSettingsStore.getState().modelId);
        set({ hydrated: true, metas: [meta], messages: { [meta.id]: [] }, activeId: meta.id });
        scheduleIndexWrite();
        return;
      }
      const metas = index.conversations ?? [];
      const activeId = index.activeId && metas.some((m) => m.id === index.activeId) ? index.activeId : (metas[0]?.id ?? null);

      set({ hydrated: true, metas, activeId, messages: {} });

      // Only the visible conversation is read up front, so the first paint after
      // a reload never waits on hundreds of messages.
      if (activeId) {
        const record = await loadConversation(activeId);
        if (record) set({ messages: { ...get().messages, [activeId]: record.messages } });
      }
      if (!metas.length) {
        get().createConversation();
      }
    },

    createConversation() {
      const meta = newMeta(useSettingsStore.getState().modelId);
      set({
        metas: [meta, ...get().metas],
        messages: { ...get().messages, [meta.id]: [] },
        activeId: meta.id,
      });
      scheduleIndexWrite();
      return meta.id;
    },

    async selectConversation(id) {
      set({ activeId: id });
      scheduleIndexWrite();
      if (!get().messages[id]) {
        const record = await loadConversation(id);
        set({ messages: { ...get().messages, [id]: record?.messages ?? [] } });
      }
    },

    async deleteConversation(id) {
      // Never leave a stream writing into a conversation that no longer exists.
      if (useLiveStore.getState().conversationId === id) {
        activeController?.abort();
        activeController = null;
        useLiveStore.getState().end();
      }
      const metas = get().metas.filter((meta) => meta.id !== id);
      const messages = { ...get().messages };
      delete messages[id];
      let activeId = get().activeId;
      if (activeId === id) activeId = metas[0]?.id ?? null;
      set({ metas, messages, activeId });
      await deleteConversationRecord(id);
      if (!metas.length) get().createConversation();
      scheduleIndexWrite();
    },

    renameConversation(id, title) {
      set({
        metas: get().metas.map((meta) => (meta.id === id ? { ...meta, title: title.slice(0, 80) || 'New chat' } : meta)),
      });
      scheduleIndexWrite();
      scheduleConversationWrite(id);
    },

    async clearEverything() {
      activeController?.abort();
      activeController = null;
      useLiveStore.getState().end();
      await clearChatStorage();
      await unloadBrowserModel();
      await purgeBrowserModelCache();
      const meta = newMeta(useSettingsStore.getState().modelId);
      set({ metas: [meta], messages: { [meta.id]: [] }, activeId: meta.id, hydrated: true });
      scheduleIndexWrite();
    },

    async send(text) {
      const clean = text.trim();
      if (!clean) return;
      if (useLiveStore.getState().phase !== 'idle') return;

      const settings = useSettingsStore.getState();
      const entry = resolveEntry(settings.modelId);
      if (!assertSendable(entry)) return;

      // An explicit "remember that …" is stored before the request goes out, so
      // the fact in the system prompt and the reply the user reads agree.
      reportMemory(useMemoryStore.getState().rememberIfAsked(clean));

      const conversationId = ensureActive();
      const now = Date.now();

      const userMessage: ChatMessage = {
        id: uid('m'),
        role: 'user',
        content: clean,
        createdAt: now,
        status: 'done',
      };
      const assistantId = uid('m');
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: now + 1,
        status: 'pending',
        modelId: modelKey(entry),
        modelLabel: entry.label,
        providerId: entry.provider,
      };

      const existing = get().messages[conversationId] ?? EMPTY_MESSAGES;
      touchConversation(conversationId, [...existing, userMessage, assistantMessage]);

      const meta = get().metas.find((m) => m.id === conversationId);
      if (meta && (meta.title === 'New chat' || !existing.some((m) => m.role === 'user'))) {
        get().renameConversation(conversationId, titleFromContent(clean));
      }

      await runAssistant(conversationId, assistantId, entry);
    },

    stop() {
      activeController?.abort();
    },

    async regenerate(assistantMessageId) {
      if (useLiveStore.getState().phase !== 'idle') return;
      const conversationId = get().activeId;
      if (!conversationId) return;
      const messages = get().messages[conversationId] ?? EMPTY_MESSAGES;
      const index = messages.findIndex((m) => m.id === assistantMessageId);
      if (index < 0) return;

      // Everything from this reply onward is replaced, so the history handed to
      // the provider ends on the user's question.
      const kept = messages.slice(0, index);
      const settings = useSettingsStore.getState();
      const entry = resolveEntry(settings.modelId);
      const assistant: ChatMessage = {
        id: uid('m'),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        status: 'pending',
        modelId: modelKey(entry),
        modelLabel: entry.label,
        providerId: entry.provider,
      };
      touchConversation(conversationId, [...kept, assistant]);
      await runAssistant(conversationId, assistant.id, entry);
    },

    async editAndResend(userMessageId, content) {
      if (useLiveStore.getState().phase !== 'idle') return;
      const clean = content.trim();
      const conversationId = get().activeId;
      if (!conversationId || !clean) return;
      const messages = get().messages[conversationId] ?? EMPTY_MESSAGES;
      const index = messages.findIndex((m) => m.id === userMessageId);
      if (index < 0) return;

      const edited: ChatMessage = { ...messages[index], content: clean, createdAt: Date.now(), status: 'done' };
      const kept = [...messages.slice(0, index), edited];
      const settings = useSettingsStore.getState();
      const entry = resolveEntry(settings.modelId);
      const assistant: ChatMessage = {
        id: uid('m'),
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        status: 'pending',
        modelId: modelKey(entry),
        modelLabel: entry.label,
        providerId: entry.provider,
      };
      touchConversation(conversationId, [...kept, assistant]);
      await runAssistant(conversationId, assistant.id, entry);
    },

    deleteMessage(messageId) {
      const conversationId = get().activeId;
      if (!conversationId) return;
      const messages = get().messages[conversationId] ?? EMPTY_MESSAGES;
      touchConversation(
        conversationId,
        messages.filter((m) => m.id !== messageId),
      );
      writeConversationNow(conversationId);
    },
  };
});

/** Convenience selector: the messages of the visible conversation. */
export function selectActiveMessages(state: ChatState): ChatMessage[] {
  if (!state.activeId) return EMPTY_MESSAGES;
  return state.messages[state.activeId] ?? EMPTY_MESSAGES;
}
