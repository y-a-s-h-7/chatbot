import { useToastStore, type Toast } from '../../store/toastStore';
import { cn } from '../../lib/utils';
import { AlertIcon, CheckIcon, InfoIcon, XIcon } from '../icons';

export function Toasts() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  const errors = toasts.filter((toast) => toast.kind === 'error');
  const others = toasts.filter((toast) => toast.kind !== 'error');

  return (
    // Raised clear of the composer: a toast that sits on top of the model pill
    // or the send button silently swallows clicks.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-60 flex flex-col items-center gap-2 px-3 pt-3 pb-36 sm:items-end sm:px-5 sm:pt-5 sm:pb-32">
      {/* Errors interrupt politely but insistently; everything else waits its turn. */}
      <div role="alert" aria-live="assertive" className="contents">
        {errors.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
      <div role="status" aria-live="polite" className="contents">
        {others.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss(): void }) {
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border border-line bg-surface/98 p-3 shadow-[var(--shadow-pop)] backdrop-blur animate-in',
        toast.kind === 'error' && 'border-danger/40',
      )}
    >
      <span
        className={cn(
          'mt-0.5 shrink-0',
          toast.kind === 'error' ? 'text-danger' : toast.kind === 'success' ? 'text-success' : 'text-accent',
        )}
      >
        {toast.kind === 'error' ? <AlertIcon size={16} /> : toast.kind === 'success' ? <CheckIcon size={16} /> : <InfoIcon size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-fg">{toast.title}</p>
        {toast.message && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{toast.message.replace(/\*\*/g, '')}</p>}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action?.run();
              onDismiss();
            }}
            className="mt-1.5 rounded-lg border border-line px-2 py-1 text-[12px] font-medium text-fg transition-colors hover:bg-surface-2"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}
