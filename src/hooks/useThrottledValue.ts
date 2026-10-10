import { useEffect, useRef, useState } from 'react';

/**
 * Trailing-edge throttle.
 *
 * The streaming bubble receives new text every frame. Re-parsing markdown that
 * often is wasted work: the layout barely changes between frames, so we cap the
 * re-parse rate and always land on the newest value. The final text is rendered
 * from the settled message, so no update can be lost.
 */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value);
  const latest = useRef(value);
  const lastFlush = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  latest.current = value;

  useEffect(() => {
    const flush = () => {
      timer.current = null;
      lastFlush.current = Date.now();
      setThrottled(latest.current);
    };

    const elapsed = Date.now() - lastFlush.current;
    if (elapsed >= intervalMs) {
      flush();
      return;
    }
    if (timer.current === null) {
      timer.current = setTimeout(flush, intervalMs - elapsed);
    }
  }, [value, intervalMs]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return throttled;
}
