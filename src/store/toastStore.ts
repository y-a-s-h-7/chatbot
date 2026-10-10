import { create } from 'zustand';
import { uid } from '../lib/utils';

export type ToastKind = 'error' | 'info' | 'success';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  action?: { label: string; run: () => void };
  /** Errors stay until dismissed or acted on; everything else fades. */
  sticky?: boolean;
}

interface ToastState {
  toasts: Toast[];
  push(toast: Omit<Toast, 'id'>): string;
  dismiss(id: string): void;
  clear(): void;
}

const AUTO_DISMISS: Record<ToastKind, number> = { error: 9000, info: 5000, success: 3500 };

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push(toast) {
    const id = uid('toast');
    const entry: Toast = { ...toast, id };
    set({ toasts: [...get().toasts.filter((t) => t.title !== toast.title || t.kind !== toast.kind).slice(-3), entry] });
    if (!toast.sticky) {
      setTimeout(() => {
        set({ toasts: get().toasts.filter((t) => t.id !== id) });
      }, AUTO_DISMISS[toast.kind]);
    }
    return id;
  },

  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  clear() {
    set({ toasts: [] });
  },
}));

export function toastError(title: string, message?: string, action?: Toast['action']): void {
  useToastStore.getState().push({ kind: 'error', title, message, action, sticky: true });
}

export function toastInfo(title: string, message?: string): void {
  useToastStore.getState().push({ kind: 'info', title, message });
}

export function toastSuccess(title: string, message?: string): void {
  useToastStore.getState().push({ kind: 'success', title, message });
}
