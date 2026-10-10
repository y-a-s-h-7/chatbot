import { useMemo } from 'react';

/** A small human touch in the empty state, stable for the life of the session. */
export function useGreeting(): string {
  return useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return 'Still up?';
    if (hour < 12) return 'Good morning.';
    if (hour < 18) return 'Good afternoon.';
    return 'Good evening.';
  }, []);
}
