/**
 * Tokens arrive far faster than a display refreshes. Writing each one into React
 * state is what makes chat UIs stutter, so we accumulate and flush once per
 * animation frame instead: one render per frame, no matter the token rate.
 *
 * A timer is armed alongside the frame request as a safety net. Some embedded
 * webviews and background tabs service animation frames rarely or not at all,
 * and text must never sit unflushed because of it.
 */

const MAX_FLUSH_DELAY_MS = 50;

export interface FrameBatcher {
  /** Replace the pending value; a flush is scheduled if one is not already. */
  push(value: string): void;
  /** Flush immediately (used for the final token and for errors). */
  flushNow(value?: string): void;
  /** The most recent value pushed, whether flushed or not. */
  readonly value: string;
  /** Cancel any scheduled flush. */
  cancel(): void;
}

export function createFrameBatcher(flush: (value: string) => void): FrameBatcher {
  let latest = '';
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearScheduled = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const run = () => {
    clearScheduled();
    flush(latest);
  };

  return {
    push(value: string) {
      latest = value;
      if (frame || timer) return;
      frame = requestAnimationFrame(run);
      timer = setTimeout(run, MAX_FLUSH_DELAY_MS);
    },
    flushNow(value?: string) {
      if (typeof value === 'string') latest = value;
      clearScheduled();
      flush(latest);
    },
    get value() {
      return latest;
    },
    cancel() {
      clearScheduled();
    },
  };
}

/**
 * Coalesces bursts of calls into at most one per frame (with the same timeout
 * safety net). Used for scroll writes and any other work that should follow the
 * display refresh rather than every token.
 */
export function createCoalescer(run: () => void, maxDelayMs = MAX_FLUSH_DELAY_MS) {
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const invoke = () => {
    clear();
    run();
  };

  return {
    schedule() {
      if (frame || timer) return;
      frame = requestAnimationFrame(invoke);
      timer = setTimeout(invoke, maxDelayMs);
    },
    cancel: clear,
  };
}
