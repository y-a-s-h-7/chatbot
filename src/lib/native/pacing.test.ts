import { describe, expect, it } from 'vitest';
import { pacingDelayMs, pacedSseStream, singleChunkStream, splitSseFrames } from './pacing';

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(decoder.decode(value));
  }
  return chunks;
}

describe('splitSseFrames', () => {
  it('returns nothing for an empty body', () => {
    expect(splitSseFrames('')).toEqual([]);
    expect(splitSseFrames('\n\n')).toEqual([]);
  });

  it('keeps the blank-line terminator with each frame', () => {
    expect(splitSseFrames('data: a\n\ndata: b\n\n')).toEqual(['data: a\n\n', 'data: b\n\n']);
  });

  it('keeps a final frame that was never terminated', () => {
    expect(splitSseFrames('data: a\n\ndata: b')).toEqual(['data: a\n\n', 'data: b']);
  });

  it('normalises CRLF bodies, which some providers send', () => {
    expect(splitSseFrames('data: a\r\n\r\ndata: b\r\n\r\n')).toEqual(['data: a\n\n', 'data: b\n\n']);
  });

  it('treats a body with no blank lines as one frame', () => {
    expect(splitSseFrames('{"error":"nope"}')).toEqual(['{"error":"nope"}']);
  });

  it('drops whitespace-only frames', () => {
    expect(splitSseFrames('data: a\n\n   \n\ndata: b\n\n')).toEqual(['data: a\n\n', 'data: b\n\n']);
  });
});

describe('pacingDelayMs', () => {
  it('never freezes on a tiny answer or flickers on a huge one', () => {
    expect(pacingDelayMs(1)).toBe(24);
    expect(pacingDelayMs(10)).toBe(24);
    expect(pacingDelayMs(1000)).toBe(4);
  });

  it('keeps a long answer inside a couple of seconds', () => {
    const frames = 300;
    expect(pacingDelayMs(frames) * frames).toBeLessThanOrEqual(2400);
  });
});

describe('pacedSseStream', () => {
  it('yields every frame, in order and unchanged', async () => {
    const body = 'data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\n';
    const chunks = await collect(pacedSseStream(body, { delayMs: 0 }));
    expect(chunks).toEqual(['data: {"a":1}\n\n', 'data: {"a":2}\n\n', 'data: [DONE]\n\n']);
  });

  it('waits between frames but not after the last one', async () => {
    const sleeps: number[] = [];
    const stream = pacedSseStream('a\n\nb\n\nc\n\n', {
      delayMs: 5,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await collect(stream);
    expect(sleeps).toEqual([5, 5]);
  });

  it('produces the same text as the buffered body', async () => {
    const body = 'data: a\n\ndata: b\n\n';
    expect((await collect(pacedSseStream(body, { delayMs: 0 }))).join('')).toBe(body);
  });

  it('stops pacing as soon as the consumer cancels (the Stop button)', async () => {
    let slept = 0;
    const stream = pacedSseStream('a\n\nb\n\nc\n\nd\n\n', {
      delayMs: 5,
      sleep: async () => {
        slept += 1;
      },
    });
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.value).toBeTruthy();
    await reader.cancel();
    // At most the sleep that was already in flight: the rest of the reply is not
    // revealed to nobody.
    expect(slept).toBeLessThanOrEqual(1);
  });
});

describe('singleChunkStream', () => {
  it('delivers the body in one piece', async () => {
    expect(await collect(singleChunkStream('{"error":"x"}'))).toEqual(['{"error":"x"}']);
  });

  it('closes cleanly for an empty body', async () => {
    expect(await collect(singleChunkStream(''))).toEqual(['']);
  });
});
