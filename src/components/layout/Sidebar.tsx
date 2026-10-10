import { useMemo, useState } from 'react';
import { cn, formatRelativeTime } from '../../lib/utils';
import { useChatStore } from '../../store/chatStore';
import { useLiveStore } from '../../store/liveStore';
import { useSettingsStore } from '../../store/settingsStore';
import { ConfirmDialog } from '../ui/Dialog';
import { IconButton } from '../ui/controls';
import { MenuIcon, PanelIcon, PlusIcon, SettingsIcon, TrashIcon, XIcon } from '../icons';

interface SidebarProps {
  mobileOpen: boolean;
  onCloseMobile(): void;
  onOpenSettings(): void;
}

export function Sidebar({ mobileOpen, onCloseMobile, onOpenSettings }: SidebarProps) {
  const metas = useChatStore((state) => state.metas);
  const activeId = useChatStore((state) => state.activeId);
  const select = useChatStore((state) => state.selectConversation);
  const create = useChatStore((state) => state.createConversation);
  const remove = useChatStore((state) => state.deleteConversation);
  const collapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);
  const liveConversation = useLiveStore((state) => state.conversationId);
  const livePhase = useLiveStore((state) => state.phase);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const sorted = useMemo(() => [...metas].sort((a, b) => b.updatedAt - a.updatedAt), [metas]);

  return (
    <>
      {/* Mobile scrim */}
      <div
        className={cn(
          'fixed inset-0 z-30 bg-black/40 transition-opacity duration-200 md:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onCloseMobile}
        aria-hidden="true"
      />

      <aside
        aria-label="Conversations"
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[84%] max-w-[19rem] flex-col border-r border-line bg-canvas',
          'transition-transform duration-250 ease-[var(--ease-out-soft)]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: in-flow, collapsible.
          'md:relative md:z-0 md:translate-x-0 md:transition-[width,margin]',
          collapsed ? 'md:w-0 md:overflow-hidden md:border-r-0' : 'md:w-[17.5rem]',
        )}
      >
        <div className="pt-safe flex items-center gap-1 px-3 py-3">
          <button
            type="button"
            onClick={() => void create()}
            className="inline-flex h-9 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
          >
            <PlusIcon size={15} />
            New chat
          </button>
          <IconButton label="Hide sidebar" className="hidden md:inline-flex" onClick={() => setCollapsed(true)}>
            <PanelIcon size={17} />
          </IconButton>
          <IconButton label="Close menu" className="md:hidden" onClick={onCloseMobile}>
            <XIcon size={18} />
          </IconButton>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2 pb-3">
          {!sorted.length && <p className="px-3 py-6 text-sm text-muted">No conversations yet.</p>}
          <ul className="space-y-0.5">
            {sorted.map((meta) => {
              const isActive = meta.id === activeId;
              const isStreamingHere = livePhase !== 'idle' && liveConversation === meta.id;
              return (
                <li key={meta.id}>
                  <div
                    className={cn(
                      'group/row flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors duration-150',
                      isActive ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        void select(meta.id);
                        onCloseMobile();
                      }}
                      aria-current={isActive ? 'true' : undefined}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex items-center gap-1.5">
                        {isStreamingHere && (
                          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" aria-label="Replying" />
                        )}
                        <span className={cn('truncate text-[13px]', isActive ? 'font-medium text-fg' : 'text-fg/85')}>
                          {meta.title}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">
                        {formatRelativeTime(meta.updatedAt)}
                        {meta.messageCount ? ` · ${meta.messageCount} messages` : ''}
                      </span>
                    </button>
                    <IconButton
                      label={`Delete ${meta.title}`}
                      size={26}
                      className="opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
                      onClick={() => setPendingDelete(meta.id)}
                    >
                      <TrashIcon size={14} />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="pb-safe border-t border-line px-3 py-2.5">
          <button
            type="button"
            onClick={() => {
              onOpenSettings();
              onCloseMobile();
            }}
            className="inline-flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <SettingsIcon size={16} />
            Settings
          </button>
        </div>
      </aside>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this conversation?"
        body="The messages are removed from this device immediately. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete);
        }}
      />

      {/* Desktop rail shown when the sidebar is hidden. */}
      {collapsed && (
        <div className="absolute left-0 top-0 z-20 hidden flex-col gap-1 p-2 md:flex">
          <IconButton label="Show sidebar" onClick={() => setCollapsed(false)}>
            <MenuIcon size={17} />
          </IconButton>
        </div>
      )}
    </>
  );
}
