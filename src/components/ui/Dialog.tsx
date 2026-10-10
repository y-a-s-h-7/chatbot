import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { XIcon } from '../icons';

interface DialogProps {
  open: boolean;
  onClose(): void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Widens the panel for settings; the picker uses the 'palette' size. */
  size?: 'sm' | 'md' | 'lg' | 'palette';
  /** Hide the visible title row when the content brings its own header. */
  hideHeader?: boolean;
  initialFocus?: 'first' | 'none';
}

const SIZES: Record<NonNullable<DialogProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  palette: 'max-w-xl',
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  hideHeader = false,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    const first = focusables()[0];
    // Defer so the element exists and any entrance animation has started.
    const timer = setTimeout(() => (first ?? panel)?.focus({ preventScroll: true }), 20);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === items[0] || !items.includes(active as HTMLElement))) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (!event.shiftKey && active === items[items.length - 1]) {
        event.preventDefault();
        items[0].focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] animate-in-fast"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hideHeader ? undefined : titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-label={hideHeader ? title : undefined}
        tabIndex={-1}
        className={cn(
          'relative w-full overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-pop)] animate-pop',
          'max-h-[min(88vh,900px)] flex flex-col',
          SIZES[size],
        )}
      >
        {!hideHeader && (
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-lg leading-tight text-fg">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-muted">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <XIcon size={18} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</div>
        {footer && <div className="border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm(): void;
  onClose(): void;
}

export function ConfirmDialog({ open, title, body, confirmLabel, destructive, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              destructive
                ? 'bg-danger text-white hover:opacity-90'
                : 'bg-accent text-accent-contrast hover:opacity-90',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="px-5 py-4 text-sm text-muted">{body}</div>
    </Dialog>
  );
}
