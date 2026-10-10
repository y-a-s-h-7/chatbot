import { memo } from 'react';
import { BookIcon, WandIcon, BlocksIcon, GlobeIcon, KeyIcon, CpuIcon, AlertIcon } from '../icons';

const SUGGESTIONS = [
  {
    icon: BookIcon,
    title: 'Summarize',
    prompt: 'Summarize the key points of the text I paste below in five bullets.',
  },
  {
    icon: WandIcon,
    title: 'Rewrite',
    prompt: 'Rewrite the following so it sounds clearer and more confident, keeping the meaning:',
  },
  {
    icon: BlocksIcon,
    title: 'Explain code',
    prompt: 'Explain what this code does, then point out anything risky in it:\n\n```\n\n```',
  },
  {
    icon: GlobeIcon,
    title: 'Translate',
    prompt: 'Translate the following into natural, idiomatic English:',
  },
];

interface EmptyStateProps {
  greeting: string;
  modelName: string;
  ready: boolean;
  unavailableReason?: string;
  browserModel?: { id: string; label: string };
  webGpuAvailable: boolean;
  onPick(prompt: string): void;
  onUseBrowserModel?: () => void;
  onAddKey?: () => void;
}

export const EmptyState = memo(function EmptyState({
  greeting,
  modelName,
  ready,
  unavailableReason,
  browserModel,
  webGpuAvailable,
  onPick,
  onUseBrowserModel,
  onAddKey,
}: EmptyStateProps) {
  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-col justify-center px-1 py-10 sm:py-14 animate-in">
      <p className="text-sm text-muted">{greeting}</p>
      <h1 className="mt-1 font-display text-[1.75rem] leading-tight tracking-[-0.015em] text-fg sm:text-[2.1rem]">
        What should we work on?
      </h1>

      {ready ? (
        <p className="mt-3 max-w-[38rem] text-sm leading-relaxed text-muted">
          Ready with <span className="text-fg">{modelName}</span>. Ask a question, paste something to rewrite, or drop in
          code to explain. Your chats stay on this device.
        </p>
      ) : (
        <p className="mt-3 max-w-[38rem] text-sm leading-relaxed text-muted">
          <span className="text-fg">{modelName}</span> is not usable yet. Pick one of these two ways to start — neither
          needs an account with this app.
        </p>
      )}

      {!ready && (
        <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="flex flex-col rounded-xl border border-line bg-surface/70 p-3.5">
            <span className="flex items-center gap-2 text-sm font-medium text-fg">
              <CpuIcon size={15} />
              Run a model in this browser
            </span>
            <span className="mt-1 flex-1 text-[12px] leading-relaxed text-muted">
              {webGpuAvailable
                ? `Free and private: ${browserModel?.label ?? 'an in-browser model'} runs on your GPU. One-time download, then it is cached.`
                : 'This browser has no WebGPU, so it cannot run a model locally. Chrome or Edge 113+ on desktop can.'}
            </span>
            <button
              type="button"
              disabled={!webGpuAvailable || !onUseBrowserModel}
              onClick={onUseBrowserModel}
              className="mt-2.5 self-start rounded-lg bg-accent px-2.5 py-1.5 text-[12px] font-medium text-accent-contrast transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Use the local model
            </button>
          </div>

          <div className="flex flex-col rounded-xl border border-line bg-surface/70 p-3.5">
            <span className="flex items-center gap-2 text-sm font-medium text-fg">
              <KeyIcon size={15} />
              Paste a free API key
            </span>
            <span className="mt-1 flex-1 text-[12px] leading-relaxed text-muted">
              {unavailableReason ??
                'A key from a provider with a free tier takes about a minute and stays in this browser.'}
            </span>
            <button
              type="button"
              disabled={!onAddKey}
              onClick={onAddKey}
              className="mt-2.5 self-start rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-fg transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Add a key
            </button>
          </div>
        </div>
      )}

      <div className="mt-7 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map(({ icon: Icon, title, prompt }) => (
          <button
            key={title}
            type="button"
            onClick={() => onPick(prompt)}
            className="group flex items-start gap-3 rounded-xl border border-line bg-surface/70 px-3.5 py-3 text-left transition-[background-color,border-color,transform] duration-150 hover:-translate-y-px hover:border-line-strong hover:bg-surface"
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Icon size={15} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-fg">{title}</span>
              <span className="mt-0.5 block truncate text-xs text-muted">{prompt.split('\n')[0]}</span>
            </span>
          </button>
        ))}
      </div>

      {!ready && (
        <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-muted">
          <AlertIcon size={13} />
          Chats are stored on this device. Keys are sent only to the provider that issued them, never to this app.
        </p>
      )}
    </div>
  );
});
