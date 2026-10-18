import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requireCjs = createRequire(import.meta.url);
const { createWindowState } = requireCjs('../electron/lib/window-state.cjs') as {
  createWindowState: (
    filePath: string,
    screen: { getAllDisplays(): Array<{ workArea: { x: number; y: number; width: number; height: number } }> },
  ) => {
    restore(): { width: number; height: number; x?: number; y?: number };
    track(win: unknown): void;
  };
};

let file: string;

const screen = {
  getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
};

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'chatbot-window-')), 'window-state.json');
});

function read() {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, number | boolean>;
}

describe('window state', () => {
  it('falls back to the default size on a first run', () => {
    const state = createWindowState(file, screen);
    expect(state.restore()).toEqual({ width: 1100, height: 780 });
  });

  it('restores a saved size and position', () => {
    writeFileSync(file, JSON.stringify({ x: 120, y: 80, width: 900, height: 640 }));
    expect(createWindowState(file, screen).restore()).toEqual({ x: 120, y: 80, width: 900, height: 640 });
  });

  it('never restores a window smaller than the usable minimum', () => {
    writeFileSync(file, JSON.stringify({ width: 100, height: 90 }));
    const restored = createWindowState(file, screen).restore();
    expect(restored.width).toBe(420);
    expect(restored.height).toBe(520);
  });

  it('drops a position that is no longer on any display', () => {
    // The second monitor is gone; opening there would look like the app failed
    // to start at all.
    writeFileSync(file, JSON.stringify({ x: 4000, y: 300, width: 900, height: 640 }));
    const restored = createWindowState(file, screen).restore();
    expect(restored.x).toBeUndefined();
    expect(restored.y).toBeUndefined();
    expect(restored.width).toBe(900);
  });

  it('survives a corrupt or truncated file', () => {
    writeFileSync(file, '{ not json');
    expect(createWindowState(file, screen).restore()).toEqual({ width: 1100, height: 780 });
  });

  it('saves geometry after a move or resize, debounced', () => {
    vi.useFakeTimers();
    try {
      const state = createWindowState(file, screen);
      const handlers: Record<string, () => void> = {};
      const win = {
        on: (event: string, handler: () => void) => {
          handlers[event] = handler;
        },
        isDestroyed: () => false,
        isMinimized: () => false,
        isFullScreen: () => false,
        isMaximized: () => false,
        getNormalBounds: () => ({ x: 30, y: 40, width: 1024, height: 720 }),
      };
      state.track(win);

      handlers.resize();
      handlers.resize();
      expect(() => read()).toThrow(); // two events, still one write, and not yet
      vi.advanceTimersByTime(400);
      expect(read()).toMatchObject({ x: 30, y: 40, width: 1024, height: 720 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the remembered geometry alone while the window is fullscreen', () => {
    vi.useFakeTimers();
    try {
      const state = createWindowState(file, screen);
      const handlers: Record<string, () => void> = {};
      const win = {
        on: (event: string, handler: () => void) => {
          handlers[event] = handler;
        },
        isDestroyed: () => false,
        isMinimized: () => false,
        isFullScreen: () => true,
        isMaximized: () => false,
        // A fullscreen window reports the screen, which must never become the
        // size it restores to next launch.
        getNormalBounds: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
      };
      state.track(win);
      handlers.resize();
      vi.advanceTimersByTime(400);
      expect(() => read()).toThrow();
      expect(state.restore()).toEqual({ width: 1100, height: 780 });
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});
