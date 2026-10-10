import { useEffect, useMemo, useRef, useState } from 'react';
import { cn, formatContextWindow } from '../../lib/utils';
import { getAvailability, modelKey, PROVIDERS, PROVIDER_ORDER } from '../../providers';
import type { ModelEntry } from '../../providers/models';
import type { ProviderId } from '../../providers/providers';
import { useLiveStore } from '../../store/liveStore';
import { useModelStore } from '../../store/modelStore';
import { useSettingsStore } from '../../store/settingsStore';
import { Badge } from '../ui/controls';
import { Dialog } from '../ui/Dialog';
import { KeyIcon, SearchIcon, ShieldIcon } from '../icons';

interface ModelPickerProps {
  open: boolean;
  onClose(): void;
  /** Selecting a model that needs credentials opens the key dialog instead of failing. */
  onNeedsCredential(providerId: ProviderId, modelId: string): void;
}

const STATUS_ORDER: Record<string, number> = { ready: 0, connect: 1, 'needs-key': 2, unavailable: 3 };

export function ModelPicker({ open, onClose, onNeedsCredential }: ModelPickerProps) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const models = useModelStore((state) => state.models);
  const streaming = useLiveStore((state) => state.phase !== 'idle');
  const activeModelId = useSettingsStore((state) => state.modelId);
  const setModel = useSettingsStore((state) => state.setModel);
  const discover = useModelStore((state) => state.discover);

  // Pull live lists for providers that already have credentials.
  useEffect(() => {
    if (!open) return;
    // Opening the picker is an explicit ask, so refresh every provider that could
    // have changed since last time (a key pasted, a base URL corrected).
    for (const id of PROVIDER_ORDER) {
      if (id === 'browser' || id === 'free-proxy') continue;
      void discover(id, { force: true });
    }
  }, [open, discover]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
    }
  }, [open]);

  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const withStatus = models.map((entry) => ({ entry, availability: getAvailability(entry) }));
    const filtered = needle
      ? withStatus.filter(({ entry }) => {
          const haystack = `${entry.label} ${entry.id} ${PROVIDERS[entry.provider].name} ${(entry.tags ?? []).join(' ')}`.toLowerCase();
          return haystack.includes(needle);
        })
      : withStatus;
    // Ready models first, then a stable order inside each provider group.
    return filtered.sort((a, b) => {
      const status = STATUS_ORDER[a.availability.status] - STATUS_ORDER[b.availability.status];
      if (status !== 0) return status;
      return PROVIDER_ORDER.indexOf(a.entry.provider) - PROVIDER_ORDER.indexOf(b.entry.provider);
    });
  }, [models, query]);

  useEffect(() => {
    setHighlight((current) => Math.min(current, Math.max(0, options.length - 1)));
  }, [options.length]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  function choose(entry: ModelEntry) {
    // Mid-stream switching would leave the current reply attributed to a model
    // the user is no longer on, so it waits for Stop.
    if (streaming) return;
    const availability = getAvailability(entry);
    if (availability.status === 'needs-key' || availability.status === 'connect') {
      setModel(modelKey(entry));
      onClose();
      onNeedsCredential(entry.provider, entry.id);
      return;
    }
    if (availability.status === 'unavailable') return;
    setModel(modelKey(entry));
    onClose();
  }

  const grouped = useMemo(() => {
    const groups = new Map<ProviderId, typeof options>();
    for (const option of options) {
      const list = groups.get(option.entry.provider) ?? [];
      list.push(option);
      groups.set(option.entry.provider, list);
    }
    return groups;
  }, [options]);

  const highlighted = options[highlight];

  return (
    <Dialog open={open} onClose={onClose} title="Choose a model" size="palette" hideHeader>
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <SearchIcon size={17} />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setHighlight((index) => Math.min(index + 1, options.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlight((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (highlighted) choose(highlighted.entry);
            }
          }}
          placeholder="Search models, providers, or capabilities…"
          aria-label="Search models"
          className="w-full bg-transparent text-[15px] text-fg placeholder:text-muted focus:outline-none"
        />
        <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[10px] text-muted sm:block">Esc</kbd>
      </div>

      <div ref={listRef} className="max-h-[min(60vh,520px)] overflow-y-auto scrollbar-thin px-2 py-2">
        {!options.length && (
          <p className="px-3 py-8 text-center text-sm text-muted">No model matches “{query}”.</p>
        )}
        {[...grouped.entries()].map(([providerId, group]) => (
          <div key={providerId} className="mb-1">
            <div className="flex items-center gap-2 px-2.5 pb-1 pt-3">
              <span className="font-display text-[13px] uppercase tracking-[0.08em] text-muted">
                {PROVIDERS[providerId].name}
              </span>
              {PROVIDERS[providerId].keyless && <Badge tone="muted">no key</Badge>}
              {PROVIDERS[providerId].connect.supported && <Badge tone="accent">one-click connect</Badge>}
            </div>
            {group.map(({ entry, availability }) => {
              const key = modelKey(entry);
              const index = options.findIndex((option) => modelKey(option.entry) === key);
              const isHighlighted = index === highlight;
              const isActive = key === activeModelId || entry.id === activeModelId;
              return (
                <button
                  key={key}
                  type="button"
                  data-index={index}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(entry)}
                  disabled={availability.status === 'unavailable' || streaming}
                  aria-selected={isActive}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-100',
                    isHighlighted && 'bg-surface-2',
                    (availability.status === 'unavailable' || streaming) && 'cursor-not-allowed opacity-55',
                  )}
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
                    {availability.status === 'ready' ? <ShieldIcon size={13} /> : <KeyIcon size={13} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-fg">{entry.label}</span>
                      {isActive && <Badge tone="accent">current</Badge>}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted">
                      {[formatContextWindow(entry.contextWindow), entry.tags?.slice(0, 3).join(' · '), entry.id !== entry.label ? entry.id : '']
                        .filter(Boolean)
                        .join('  ·  ')}
                    </span>
                  </span>
                  <Badge tone={availability.status === 'ready' ? 'success' : 'muted'} className="mt-0.5 shrink-0">
                    {availability.badge}
                  </Badge>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="border-t border-line px-4 py-2.5">
        <p className="text-[11px] leading-relaxed text-muted">
          {streaming
            ? 'A reply is in progress — press Stop to switch models.'
            : highlighted
              ? (highlighted.entry.notes ?? highlighted.availability.detail ?? '')
              : '↑↓ to move · Enter to select'}
        </p>
      </div>
    </Dialog>
  );
}
