import { create } from 'zustand';

/**
 * Live streaming state deliberately lives outside the conversation store.
 * Only the streaming bubble and the auto-scroll driver subscribe here, so a
 * thousand tokens cost two cheap re-renders per frame instead of re-rendering
 * the whole chat.
 */

export type LivePhase = 'idle' | 'preparing' | 'thinking' | 'streaming' | 'settling';

export interface LiveState {
  /** Message currently receiving tokens. */
  messageId: string | null;
  conversationId: string | null;
  modelLabel: string | null;
  text: string;
  phase: LivePhase;
  /** e.g. "Downloading weights 42%" or a provider note. */
  statusText: string | null;
  progress: number | null;
  startedAt: number | null;

  begin(input: { messageId: string; conversationId: string; modelLabel: string; phase?: LivePhase }): void;
  setText(text: string): void;
  setPhase(phase: LivePhase): void;
  setStatus(statusText: string | null, progress?: number | null): void;
  end(): void;
}

const IDLE = {
  messageId: null,
  conversationId: null,
  modelLabel: null,
  text: '',
  phase: 'idle' as LivePhase,
  statusText: null,
  progress: null,
  startedAt: null,
};

export const useLiveStore = create<LiveState>((set, get) => ({
  ...IDLE,

  begin({ messageId, conversationId, modelLabel, phase = 'thinking' }) {
    set({ ...IDLE, messageId, conversationId, modelLabel, phase, startedAt: Date.now() });
  },

  setText(text) {
    if (text === get().text) return;
    set({ text });
  },

  setPhase(phase) {
    if (phase === get().phase) return;
    set({ phase });
  },

  setStatus(statusText, progress = null) {
    set({ statusText, progress });
  },

  end() {
    set({ ...IDLE });
  },
}));

export function isStreaming(): boolean {
  return useLiveStore.getState().phase !== 'idle';
}
