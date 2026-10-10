import { useLiveStore } from '../../store/liveStore';

/**
 * The one flourish: a soft gradient that drifts while idle and breathes while the
 * model streams. Pure CSS, no JS per frame, and it collapses to a static glow
 * under prefers-reduced-motion.
 */
export function Aura() {
  const phase = useLiveStore((state) => state.phase);
  const active = phase === 'streaming' || phase === 'thinking' || phase === 'preparing';

  return (
    <div className="pointer-events-none absolute inset-x-0 -top-6 bottom-0 overflow-hidden" aria-hidden="true">
      <div className="aura" data-state={active ? 'active' : 'idle'} />
    </div>
  );
}
