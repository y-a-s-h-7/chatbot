import { cn } from '../../lib/utils';
import { useChatStore } from '../../store/chatStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useModelStore } from '../../store/modelStore';
import { getAvailability } from '../../providers';
import { IconButton } from '../ui/controls';
import { MenuIcon, MoonIcon, SettingsIcon, SunIcon } from '../icons';

interface TopBarProps {
  onOpenMenu(): void;
  onOpenSettings(): void;
  onOpenModelPicker(): void;
}

export function TopBar({ onOpenMenu, onOpenSettings, onOpenModelPicker }: TopBarProps) {
  const activeId = useChatStore((state) => state.activeId);
  const title = useChatStore((state) => state.metas.find((meta) => meta.id === activeId)?.title ?? 'Chatbot');
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const modelId = useSettingsStore((state) => state.modelId);
  const entry = useModelStore((state) => state.byId(modelId));

  const dark = document.documentElement.classList.contains('dark');
  const availability = entry ? getAvailability(entry) : undefined;

  return (
    <header className="pt-safe flex items-center gap-2 border-b border-line/70 px-3 py-2 sm:px-4">
      <IconButton label="Open conversations" className="md:hidden" onClick={onOpenMenu}>
        <MenuIcon size={18} />
      </IconButton>
      <IconButton
        label="Show conversations"
        className={cn('hidden', sidebarCollapsed && 'md:inline-flex')}
        onClick={() => useSettingsStore.getState().setSidebarCollapsed(false)}
      >
        <MenuIcon size={18} />
      </IconButton>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[13px] font-medium text-fg sm:text-sm">{title}</h1>
        <button
          type="button"
          onClick={onOpenModelPicker}
          className="mt-0.5 hidden items-center gap-1.5 text-[11px] text-muted transition-colors hover:text-fg sm:inline-flex"
        >
          {entry?.label ?? 'Choose a model'}
          {availability && (
            <span className="rounded-full border border-line px-1.5 py-px text-[10px]">{availability.badge}</span>
          )}
        </button>
      </div>

      <IconButton
        label={theme === 'dark' ? 'Switch to light theme' : theme === 'light' ? 'Switch to dark theme' : 'Switch theme'}
        onClick={() => setTheme(dark ? 'light' : 'dark')}
      >
        {dark ? <SunIcon size={17} /> : <MoonIcon size={17} />}
      </IconButton>
      <IconButton label="Settings" onClick={onOpenSettings}>
        <SettingsIcon size={17} />
      </IconButton>
    </header>
  );
}
