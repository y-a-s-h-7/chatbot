import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoalescer, createFrameBatcher } from './streamBuffer';

/**
 * The batcher prefers animation frames but must flush on its 50 ms timer when a
 * webview never services rAF. These tests drive both paths explicitly.
 */
let frameCb: FrameRequestCallback | null = null;

beforeEach(() => {
  frameCb = null;
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameCb = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    frameCb = null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function fireFrame() {
  const cb = frameCb;
  frameCb = null;
  cb?.(0);
}

describe('createFrameBatcher', () => {
  it('does not flush synchronously on push', () => {
    const flush = vi.fn();
    const b = createFrameBatcher(flush);
    b.push('hello');
    expect(flush).not.toHaveBeenCalled();
    expect(b.value).toBe('hello');
  });

  it('coalesces many pushes into one flush with the latest value', () => {
    const flush = vi.fn();
    const b = createFrameBatcher(flush);
    b.push('a');
    b.push('ab');
    b.push('abc');
    fireFrame();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('abc');
  });

  it('flushes on the timer when rAF never fires', () => {
    const flush = vi.fn();
    const b = createFrameBatcher(flush);
    b.push('starved');
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('starved');
  });

  it('flushes at most once per scheduled cycle even as values change', () => {
    const flush = vi.fn();
    const b = createFrameBatcher(flush);
    b.push('1');
    vi.advanceTimersByTime(50);
    b.push('2');
    b.push('3');
    vi.advanceTimersByTime(50);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenLastCalledWith('3');
  });

  it('flushNow flushes immediately and cancels the scheduled flush', () => {
    const flush = vi.fn();
    const b = createFrameBatcher(flush);
    b.push('partial');
    b.flushNow('final');
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('final');
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(b.value).toBe('final');
  });

  it('flushNow() with no argument flushes the latest pushed value', () => {
    const flush = vi.fn();
    const b = createFrameBatcher(flush);
    b.push('latest');
    b.flushNow();
    expect(flush).toHaveBeenCalledWith('latest');
  });

  it('cancel prevents any further flush', () => {
    const flush = vi.fn();
    const b = createFrameBatcher(flush);
    b.push('discarded');
    b.cancel();
    fireFrame();
    vi.advanceTimersByTime(200);
    expect(flush).not.toHaveBeenCalled();
    // value is still readable for callers that persist on abort
    expect(b.value).toBe('discarded');
  });

  it('schedules again after a flush for continued streaming', () => {
    const flush = vi.fn();
    const b = createFrameBatcher(flush);
    b.push('t1');
    fireFrame();
    b.push('t2');
    fireFrame();
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenLastCalledWith('t2');
  });
});

describe('createCoalescer', () => {
  it('collapses a burst into a single run', () => {
    const run = vi.fn();
    const c = createCoalescer(run);
    c.schedule();
    c.schedule();
    c.schedule();
    fireFrame();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs on the timer fallback when rAF never fires', () => {
    const run = vi.fn();
    const c = createCoalescer(run);
    c.schedule();
    vi.advanceTimersByTime(50);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancel drops the pending run', () => {
    const run = vi.fn();
    const c = createCoalescer(run);
    c.schedule();
    c.cancel();
    vi.advanceTimersByTime(200);
    fireFrame();
    expect(run).not.toHaveBeenCalled();
  });

  it('schedules again after firing', () => {
    const run = vi.fn();
    const c = createCoalescer(run);
    c.schedule();
    fireFrame();
    c.schedule();
    fireFrame();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
