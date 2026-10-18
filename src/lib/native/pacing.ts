/**
 * Native HTTP on Android is buffered: Capacitor's bridge resolves with the whole
 * response body, so an SSE answer would arrive in one lump and the chat would
 * jump from "thinking" to a finished wall of text.
 *
 * The fix is to hand the transport layer the same interface it already consumes
 * — a byte stream — and release the frames inside it a few milliseconds apart.
 * Everything downstream (SSE parsing, token batching, auto-scroll) is unchanged;
 * only the arrival timing is synthetic.
 */

/** Split a buffered SSE body into whole frames, terminators kept. Pure. */
export function splitSseFrames(text: string): string[] {
  if (!text) return [];
  const normalised = text.replace(/\r\n/g, '\n');
  const frames: string[] = [];
  let start = 0;
  let index = normalised.indexOf('\n\n', start);
  while (index !== -1) {
    frames.push(normalised.slice(start, index + 2));
    start = index + 2;
    index = normalised.indexOf('\n\n', start);
  }
  if (start < normalised.length) frames.push(normalised.slice(start));
  return frames.filter((frame) => frame.trim().length > 0);
}

/**
 * Per-frame delay: a short answer still reads as streaming, a long one does not
 * take longer than a couple of seconds to catch up. Clamped so it is never a
 * freeze and never a flicker.
 */
export function pacingDelayMs(frameCount: number): number {
  if (frameCount <= 1) return 24;
  return Math.min(24, Math.max(4, Math.round(2400 / frameCount)));
}

interface PaceOptions {
  delayMs?: number;
  /** Injectable so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A ReadableStream that yields the buffered frames one at a time. `pull` awaits
 * the delay, which is what stops the whole body being enqueued at once.
 */
export function pacedSseStream(text: string, options: PaceOptions = {}): ReadableStream<Uint8Array> {
  const frames = splitSseFrames(text);
  const delay = options.delayMs ?? pacingDelayMs(frames.length);
  const sleep = options.sleep ?? defaultSleep;
  const encoder = new TextEncoder();
  let cursor = 0;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      if (cancelled || cursor >= frames.length) {
        close();
        return;
      }

      const frame = frames[cursor];
      cursor += 1;
      if (!cancelled) {
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          /* the reader went away mid-reveal (Stop, or a chat switch) */
        }
      }
      // A cancelled consumer means the user pressed Stop: stop pacing rather
      // than dribbling the rest of a reply nobody is waiting for.
      if (!cancelled && cursor < frames.length && delay > 0) await sleep(delay);
    },
    cancel() {
      cancelled = true;
    },
  });
}

/** One-chunk stream for bodies that are not a token stream (errors, JSON). */
export function singleChunkStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) {
        controller.close();
        return;
      }
      sent = true;
      controller.enqueue(encoder.encode(text));
    },
  });
}
